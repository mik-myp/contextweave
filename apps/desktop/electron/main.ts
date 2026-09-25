import { app, BrowserWindow, clipboard, ipcMain, safeStorage, shell, dialog } from 'electron'
// The Electron entry auto-registers unrestricted logging IPC even without initialize().
import log from 'electron-log/node'
import { existsSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { dataChangedSchema, platformSchema, architectureSchema } from '@contextweave/contracts'
import { EnvironmentRepository, openLocalDatabase } from '@contextweave/storage'
import { createApplication } from './application'
import { createAppUpdateService } from './services/app-update-service'
import { prepareAppInstaller, readInstallerFailure } from './services/app-update-installer'
import { createAppUpdateHandlers } from './app-update-ipc'
import { createAppLogService } from './services/app-log-service'
import { createAppLogHandlers } from './app-log-ipc'
import { createWindowLifecycle } from './services/window-lifecycle'
import { classifyStartupError, recoverStartup } from './services/startup-recovery'
import { fail } from './services/result'
import { createAppHandlers } from './app-ipc'
import { isTrustedIpcSender } from './services/ipc-security'
if (!app.isPackaged && process.env.CONTEXTWEAVE_USER_DATA)
  app.setPath('userData', resolve(process.env.CONTEXTWEAVE_USER_DATA))
log.transports.file.resolvePathFn = () =>
  join(app.getPath('userData'), 'contextweave', 'logs', 'main.log')
const applicationLogs = createAppLogService()
const APP_ROOT = resolve(__dirname, '..')
const DEV_SERVER_URL = app.isPackaged
  ? undefined
  : (process.env.ELECTRON_RENDERER_URL ?? process.env.VITE_DEV_SERVER_URL)
const RENDERER_ENTRY_URL =
  DEV_SERVER_URL ?? pathToFileURL(join(APP_ROOT, 'dist', 'index.html')).href
const targetPlatform = platformSchema.parse(process.platform)
const targetArch = architectureSchema.parse(process.arch)
let database: ReturnType<typeof openLocalDatabase> | undefined
let application: ReturnType<typeof createApplication> | undefined
let updates: ReturnType<typeof createAppUpdateService> | undefined
let isQuitting = false
const hasInstanceLock = app.requestSingleInstanceLock()
if (!hasInstanceLock) app.quit()

let recoveringStartup = false
const windows = createWindowLifecycle({
  create: createWindow,
  // Loading and IPC validation must share serialization (notably '~' in Windows temp paths).
  load: (window) => window.loadURL(RENDERER_ENTRY_URL),
  failed: () => {
    void handleStartupFailure(new Error('UI_LOAD_FAILED'))
  },
})
async function handleStartupFailure(error: unknown) {
  if (recoveringStartup || isQuitting) return
  recoveringStartup = true
  windows.destroy()
  log.error('Application initialization failed', { code: classifyStartupError(error) })
  await Promise.allSettled([application?.shutdown(), updates?.shutdown()])
  application = undefined
  updates = undefined
  try {
    database?.close()
  } catch {
    /* The process exits; never replace unreadable data. */
  }
  database = undefined
  const outcome = await recoverStartup({
    error,
    locale: app.getLocale(),
    show: async (message, folderFailed) =>
      (
        await dialog.showMessageBox({
          ...message,
          type: 'error',
          defaultId: 2,
          cancelId: 2,
          noLink: true,
          detail:
            message.detail +
            (folderFailed
              ? app.getLocale().startsWith('zh')
                ? '\n无法打开目录，请检查目录权限。'
                : '\nUnable to open the folder. Check directory permissions.'
              : ''),
        })
      ).response,
    openDataFolder: async () => {
      const root = join(app.getPath('userData'), 'contextweave')
      return (await shell.openPath(existsSync(root) ? root : app.getPath('userData'))) === ''
    },
  })
  if (outcome === 'restart') app.relaunch()
  app.quit()
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1120,
    minHeight: 720,
    show: false,
    backgroundColor: '#f4f7fb',
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) =>
    callback(false),
  )
  window.webContents.session.setPermissionCheckHandler(() => false)
  return window
}
if (hasInstanceLock)
  app
    .whenReady()
    .then(() => {
      const dataRoot = join(app.getPath('userData'), 'contextweave')
      const environmentRoot = join(dataRoot, 'environments')
      mkdirSync(environmentRoot, { recursive: true })
      database = openLocalDatabase(join(dataRoot, 'contextweave.sqlite'))
      const repository = new EnvironmentRepository(database.sqlite)
      const environmentStates = new Map(
        repository.listAll().map((record) => [record.environmentId, record.status]),
      )
      applicationLogs.record({ level: 'info', source: 'app', event: 'app-started', fields: {} })
      updates = createAppUpdateService({
        currentVersion: app.getVersion(),
        platform: targetPlatform,
        arch: targetArch,
        root: join(dataRoot, 'updates'),
        initialError: readInstallerFailure(join(dataRoot, 'updates')),
        installPackage: async (path, release, signal) => {
          const prepared = await prepareAppInstaller({
            platform: targetPlatform,
            arch: targetArch,
            isPackaged: app.isPackaged,
            executablePath: process.execPath,
            portable: Boolean(process.env.PORTABLE_EXECUTABLE_FILE),
            root: join(dataRoot, 'updates'),
            path,
            release,
            signal,
          })
          try {
            signal.throwIfAborted()
            if (application?.hasActiveEnvironments()) throw new Error('UPDATE_ENVIRONMENTS_ACTIVE')
            application?.setUpdating(true)
            await prepared.launch()
            setImmediate(() => app.quit())
          } catch (error) {
            application?.setUpdating(false)
            await prepared.cleanup()
            throw error
          }
        },
        openExternal: (url) => shell.openExternal(url),
        hasActiveEnvironments: () => application?.hasActiveEnvironments() ?? false,
      })
      application = createApplication({
        repository,
        dataRoot,
        platform: targetPlatform,
        arch: targetArch,
        secure: safeStorage,
        workerPath: join(__dirname, 'worker.js'),
        changed: (domains) => {
          if (domains.includes('environments')) {
            for (const record of repository.listAll()) {
              if (environmentStates.get(record.environmentId) !== record.status) {
                applicationLogs.record({
                  source: 'environment',
                  event: 'environment-state',
                  level:
                    record.status === 'error'
                      ? 'error'
                      : record.status === 'needs-recovery'
                        ? 'warn'
                        : 'info',
                  fields: { resourceId: record.environmentId, status: record.status },
                })
                environmentStates.set(record.environmentId, record.status)
              }
            }
          }
          const mainWindow = windows.get()
          if (mainWindow)
            mainWindow.webContents.send('data:changed', dataChangedSchema.parse({ domains }))
        },
      })
      application.recover()
      const localHandlers: Record<string, (input: unknown) => unknown> = {
        ...createAppUpdateHandlers(updates),
        ...createAppLogHandlers(applicationLogs, (text) => clipboard.writeText(text)),
        ...createAppHandlers({
          getInfo: () => ({
            name: 'ContextWeave',
            version: app.getVersion(),
            platform: targetPlatform,
            arch: targetArch,
            secureStorageAvailable: safeStorage.isEncryptionAvailable(),
          }),
          getPaths: () => ({
            userData: app.getPath('userData'),
            dataRoot,
            environmentRoot,
            kernelRoot: join(dataRoot, 'kernels'),
            logRoot: join(dataRoot, 'logs'),
          }),
          quit: () => app.quit(),
          openExternal: (url) => shell.openExternal(url),
        }),
      }
      for (const channel of [...application.channels, ...Object.keys(localHandlers)])
        ipcMain.handle(channel, (event, input: unknown) => {
          const mainWindow = windows.get()
          if (
            !isTrustedIpcSender(
              event,
              mainWindow,
              RENDERER_ENTRY_URL,
              isQuitting || recoveringStartup,
            )
          )
            return fail('FORBIDDEN')
          return applicationLogs.invoke(channel, input, () =>
            Object.hasOwn(localHandlers, channel)
              ? localHandlers[channel]!(input)
              : application!.invoke(channel, input),
          )
        })
      windows.ready()
    })
    .catch((error: unknown) => handleStartupFailure(error))
app.on('activate', () => windows.show())
app.on('second-instance', () => windows.show())
app.on('window-all-closed', () => {
  if (!recoveringStartup && process.platform !== 'darwin') app.quit()
})
app.on('before-quit', (event) => {
  if (isQuitting) return
  isQuitting = true
  windows.stop()
  applicationLogs.record({ level: 'info', source: 'app', event: 'app-stopping', fields: {} })
  event.preventDefault()
  void Promise.allSettled([application?.shutdown(), updates?.shutdown()]).finally(() => app.quit())
})
app.on('will-quit', () => database?.close())
