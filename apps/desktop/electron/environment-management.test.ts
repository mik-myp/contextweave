import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { defaultCommonEnvironmentConfig } from '@contextweave/contracts'
import { EnvironmentRepository, openLocalDatabase } from '@contextweave/storage'
import {
  assertProxyMutable,
  getEnvironmentDetails,
  removeEnvironment,
  updateEnvironment,
} from './environment-management'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function createRepository() {
  const directory = mkdtempSync(join(tmpdir(), 'contextweave-management-'))
  directories.push(directory)
  const database = openLocalDatabase(join(directory, 'contextweave.sqlite'))
  return { database, repository: new EnvironmentRepository(database.sqlite), directory }
}

describe('environment management boundaries', () => {
  it('updates environment metadata and rejects mutation while running', () => {
    const { database, repository, directory } = createRepository()
    repository.saveProxy('proxy-test', { type: 'http', host: '127.0.0.1', port: 8080 })
    repository.create({
      dataDir: join(directory, 'env-test'),
      platform: 'darwin',
      arch: 'arm64',
      config: {
        environmentId: 'env-test',
        name: '原名称',
        kernelId: 'standard-chromium',
        kernelVersion: 'local',
        proxyId: 'proxy-test',
        proxy: { type: 'http', host: '127.0.0.1', port: 8080 },
        commonConfig: {
          ...defaultCommonEnvironmentConfig,
          userAgent: 'Retained agent',
          platform: 'darwin',
        },
        kernelConfig: { privateOption: 'retained' },
        configVersion: 1,
      },
    })

    const updated = updateEnvironment(repository, {
      version: 1,
      environmentId: 'env-test',
      name: '新名称',
      proxyId: null,
      browserSettings: {
        language: 'en-US',
        timezone: 'UTC',
        window: { width: 1920, height: 1080 },
      },
    })
    expect(updated.name).toBe('新名称')
    expect(updated.proxyId).toBeNull()
    expect(updated.dataDir).toBe(join(directory, 'env-test'))
    expect(JSON.parse(updated.configJson)).toMatchObject({
      kernelId: 'standard-chromium',
      kernelConfig: { privateOption: 'retained' },
      commonConfig: {
        userAgent: 'Retained agent',
        platform: 'darwin',
        language: 'en-US',
        timezone: 'UTC',
        window: { width: 1920, height: 1080 },
      },
    })
    const detail = getEnvironmentDetails(repository, 'env-test')
    expect(detail.browserSettings).toEqual({
      language: 'en-US',
      timezone: 'UTC',
      window: { width: 1920, height: 1080 },
    })
    expect(detail).not.toHaveProperty('dataDir')
    expect(detail).not.toHaveProperty('kernelConfig')
    expect(detail).not.toHaveProperty('proxy')
    expect(() => getEnvironmentDetails(repository, 'missing')).toThrow('NOT_FOUND')

    repository.updateStatus('env-test', 'running')
    expect(() =>
      updateEnvironment(repository, {
        version: 1,
        environmentId: 'env-test',
        name: '再次修改',
        proxyId: null,
        browserSettings: {
          language: 'en-US',
          timezone: 'UTC',
          window: { width: 1920, height: 1080 },
        },
      }),
    ).toThrow('ENVIRONMENT_BUSY')
    database.close()
  })

  it('prevents deleting a proxy still referenced by an environment', () => {
    const { database, repository, directory } = createRepository()
    repository.saveProxy('proxy-test', { type: 'http', host: '127.0.0.1', port: 8080 })
    repository.create({
      dataDir: join(directory, 'env-test'),
      platform: 'darwin',
      arch: 'arm64',
      config: {
        environmentId: 'env-test',
        name: '环境',
        kernelId: 'standard-chromium',
        kernelVersion: 'local',
        proxyId: 'proxy-test',
        proxy: { type: 'http', host: '127.0.0.1', port: 8080 },
        commonConfig: {
          ...defaultCommonEnvironmentConfig,
          userAgent: 'Retained agent',
          platform: 'darwin',
        },
        kernelConfig: { privateOption: 'retained' },
        configVersion: 1,
      },
    })
    expect(() => assertProxyMutable(repository, 'proxy-test', true)).toThrow('PROXY_IN_USE')
    removeEnvironment(repository, 'env-test')
    expect(repository.get('env-test')?.lifecycle).toBe('trashed')
    expect(() => getEnvironmentDetails(repository, 'env-test')).toThrow('ENVIRONMENT_TRASHED')
    database.close()
  })
})
