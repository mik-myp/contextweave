import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { defaultCommonEnvironmentConfig, defaultThemeConfig } from '@contextweave/contracts'
import {
  acquireRuntimeLock,
  EnvironmentRepository,
  inspectRuntimeLock,
  openLocalDatabase,
  releaseRuntimeLock,
} from './index'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('local SQLite storage', () => {
  it('runs migrations and persists environment records', () => {
    const directory = mkdtempSync(join(tmpdir(), 'contextweave-storage-'))
    temporaryDirectories.push(directory)
    const database = openLocalDatabase(join(directory, 'contextweave.sqlite'))
    const repository = new EnvironmentRepository(database.sqlite)

    const created = repository.create({
      dataDir: join(directory, 'environments', 'env-test'),
      platform: 'win32',
      arch: 'x64',
      config: {
        environmentId: 'env-test',
        name: '测试环境',
        kernelId: 'standard-chromium',
        kernelVersion: 'local',
        commonConfig: defaultCommonEnvironmentConfig,
        kernelConfig: {},
        configVersion: 1,
      },
    })

    expect(repository.get('env-test')).toEqual(created)
    expect(repository.list()).toHaveLength(1)
    expect(repository.updateStatus('env-test', 'ready')?.status).toBe('ready')
    const proxy = repository.saveProxy('proxy-test', {
      type: 'http',
      host: '127.0.0.1',
      port: 8080,
    })
    expect(repository.getProxy('proxy-test')?.host).toBe('127.0.0.1')
    expect(repository.listProxies()).toContainEqual(proxy)
    expect(repository.recordKernelInstallation({
      kernelId: 'standard-chromium',
      version: 'local',
      platform: 'win32',
      arch: 'x64',
      sourceUrl: null,
      sha256: null,
      installPath: join(directory, 'kernels', 'standard'),
      state: 'installed',
    }).state).toBe('installed')
    repository.setSetting('theme', { ...defaultThemeConfig, mode: 'dark' })
    expect(repository.getSetting<typeof defaultThemeConfig>('theme')?.mode).toBe('dark')
    const updated = repository.updateConfig({
      environmentId: 'env-test',
      name: '重命名环境',
      kernelId: 'standard-chromium',
      kernelVersion: 'local',
      proxyId: 'proxy-test',
      proxy: {
        type: 'http',
        host: '127.0.0.1',
        port: 8080,
      },
      commonConfig: defaultCommonEnvironmentConfig,
      kernelConfig: {},
      configVersion: 1,
    })
    expect(updated?.name).toBe('重命名环境')
    expect(updated?.proxyId).toBe('proxy-test')
    expect(JSON.parse(updated?.configJson ?? '{}').name).toBe('重命名环境')
    repository.deleteEnvironment('env-test')
    expect(repository.get('env-test')).toBeUndefined()
    database.close()
  })

  it('uses an atomic environment lock and removes stale owners', () => {
    const directory = mkdtempSync(join(tmpdir(), 'contextweave-lock-'))
    temporaryDirectories.push(directory)
    const first = acquireRuntimeLock(directory, {
      pid: process.pid,
      sessionId: 'session-live',
      controlPort: 9222,
      startedAt: new Date().toISOString(),
    })
    expect(first.acquired).toBe(true)
    expect(acquireRuntimeLock(directory, {
      pid: process.pid,
      sessionId: 'session-other',
      controlPort: 9223,
      startedAt: new Date().toISOString(),
    }).acquired).toBe(false)
    expect(inspectRuntimeLock(directory).live).toBe(true)
    releaseRuntimeLock(directory, 'session-other')
    expect(inspectRuntimeLock(directory).live).toBe(true)
    releaseRuntimeLock(directory, 'session-live')

    const lockDirectory = join(directory, '.runtime.lock')
    mkdirSync(lockDirectory)
    writeFileSync(join(lockDirectory, 'owner.json'), `${JSON.stringify({
      pid: 2147483647,
      sessionId: 'session-dead',
      controlPort: 9224,
      startedAt: new Date().toISOString(),
    })}\n`, { encoding: 'utf8' })
    expect(acquireRuntimeLock(directory, {
      pid: process.pid,
      sessionId: 'session-recovered',
      controlPort: 9225,
      startedAt: new Date().toISOString(),
    }).acquired).toBe(true)
    releaseRuntimeLock(directory, 'session-recovered')
  })
})
