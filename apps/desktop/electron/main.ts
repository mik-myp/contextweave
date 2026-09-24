import { app, BrowserWindow, clipboard, ipcMain, safeStorage, shell } from 'electron'
import log from 'electron-log/main'
import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { z } from 'zod'
import { dataChangedSchema, platformSchema, architectureSchema } from '@contextweave/contracts'
import { EnvironmentRepository, openLocalDatabase } from '@contextweave/storage'
import { createApplication } from './application'
import { createAppUpdateService } from './services/app-update-service'
import { createAppUpdateHandlers } from './app-update-ipc'
import { createAppLogService } from './services/app-log-service'
import { createAppLogHandlers } from './app-log-ipc'
import { ok, fail } from './services/result'
if (!app.isPackaged && process.env.CONTEXTWEAVE_USER_DATA)
  app.setPath('userData', resolve(process.env.CONTEXTWEAVE_USER_DATA))
log.transports.file.resolvePathFn = () =>
  join(app.getPath('userData'), 'contextweave', 'logs', 'main.log')
log.initialize()
const applicationLogs = createAppLogService()
const APP_ROOT = resolve(__dirname, '..')
const DEV_SERVER_URL = process.env.ELECTRON_RENDERER_URL ?? process.env.VITE_DEV_SERVER_URL
const targetPlatform = platformSchema.parse(process.platform)
const targetArch = architectureSchema.parse(process.arch)
let database: ReturnType<typeof openLocalDatabase> | undefined
let application: ReturnType<typeof createApplication> | undefined
let updates: ReturnType<typeof createAppUpdateService> | undefined
let mainWindow: BrowserWindow | null = null
let isQuitting = false
const hasInstanceLock = app.requestSingleInstanceLock()
if (!hasInstanceLock) app.quit()

function createWindow() {
  mainWindow = new BrowserWindow({
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
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault())
  mainWindow.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) =>
    callback(false),
  )
  mainWindow.webContents.session.setPermissionCheckHandler(() => false)
  mainWindow.once('ready-to-show', () => mainWindow?.show())
  if (DEV_SERVER_URL) void mainWindow.loadURL(DEV_SERVER_URL)
  else void mainWindow.loadFile(join(APP_ROOT, 'dist', 'index.html'))
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
        openPath: (path) => shell.openPath(path),
        openExternal: (url) => shell.openExternal(url),
        hasActiveEnvironments: () =>
          repository
            .list()
            .some((record) =>
              ['running', 'starting', 'stopping', 'needs-recovery'].includes(record.status),
            ),
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
          if (mainWindow && !mainWindow.isDestroyed())
            mainWindow.webContents.send('data:changed', dataChangedSchema.parse({ domains }))
        },
      })
      application.recover()
      const localHandlers: Record<string, (input: unknown) => unknown> = {
        ...createAppUpdateHandlers(updates),
        ...createAppLogHandlers(applicationLogs, (text) => clipboard.writeText(text)),
        'app:get-info': () =>
          ok({
            name: 'ContextWeave',
            version: app.getVersion(),
            platform: targetPlatform,
            arch: targetArch,
            secureStorageAvailable: safeStorage.isEncryptionAvailable(),
          }),
        'app:get-paths': () =>
          ok({
            userData: app.getPath('userData'),
            dataRoot,
            environmentRoot,
            kernelRoot: join(dataRoot, 'kernels'),
            logRoot: join(dataRoot, 'logs'),
          }),
        'app:quit': () => {
          setImmediate(() => app.quit())
          return ok(true)
        },
        'app:open-external': (input) => {
          const parsed = z.string().url().safeParse(input)
          if (!parsed.success || !/^https?:\/\//i.test(parsed.data)) return fail('INVALID_URL')
          void shell.openExternal(parsed.data).catch(() => log.warn('Unable to open external URL'))
          return ok(true)
        },
      }
      for (const channel of [...application.channels, ...Object.keys(localHandlers)])
        ipcMain.handle(channel, (event, input: unknown) => {
          if (!mainWindow || event.senderFrame !== mainWindow.webContents.mainFrame)
            return fail('FORBIDDEN')
          return applicationLogs.invoke(channel, input, () =>
            localHandlers[channel]
              ? localHandlers[channel](input)
              : application!.invoke(channel, input),
          )
        })
      createWindow()
      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow()
      })
    })
    .catch((error) => {
      log.error('Failed to initialize local application', error)
      app.quit()
    })
app.on('second-instance', () => {
  mainWindow?.show()
  mainWindow?.focus()
})
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
app.on('before-quit', (event) => {
  if (isQuitting) return
  isQuitting = true
  applicationLogs.record({ level: 'info', source: 'app', event: 'app-stopping', fields: {} })
  event.preventDefault()
  void Promise.allSettled([application?.shutdown(), updates?.shutdown()]).finally(() => app.quit())
})
app.on('will-quit', () => database?.close())
