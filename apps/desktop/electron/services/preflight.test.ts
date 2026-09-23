import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import {
  environmentConfigSchema,
  platformSchema,
  architectureSchema,
} from '@contextweave/contracts'
import { EnvironmentRepository, openLocalDatabase } from '@contextweave/storage'
import { checkEnvironment } from './preflight'
import { createKernelService } from './kernel-service'
import { createCredentialStore } from './credentials'
const cleanups: (() => void)[] = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'cw-preflight-')),
    dir = join(root, 'env')
  mkdirSync(dir)
  const db = openLocalDatabase(join(root, 'data.sqlite'))
  cleanups.push(() => {
    db.close()
    rmSync(root, { recursive: true, force: true })
  })
  const repository = new EnvironmentRepository(db.sqlite)
  const config = environmentConfigSchema.parse({
    environmentId: 'env-a',
    name: 'A',
    kernelId: 'standard-chromium',
    kernelVersion: 'local',
    commonConfig: { language: 'system', timezone: 'system' },
  })
  const record = repository.create({
    config,
    dataDir: dir,
    platform: platformSchema.parse(process.platform),
    arch: architectureSchema.parse(process.arch),
  })
  const kernels = createKernelService(repository, record.platform, record.arch)
  vi.spyOn(kernels, 'executableFor').mockReturnValue(undefined)
  return { root, dir, repository, record, config, kernels }
}
it('reports multiple actionable blockers without leaking credentials or granting a native fingerprint guarantee', async () => {
  const { record, repository, kernels, config } = fixture()
  repository.saveProxy('proxy', {
    type: 'http',
    host: '127.0.0.1',
    port: 1,
    username: 'user',
    credentialRef: 'secret-ref',
  })
  const changed = repository.updateConfig({ ...config, proxyId: 'proxy' })!
  const report = await checkEnvironment({ ...changed, lifecycle: 'trashed' }, repository, kernels, {
    read: () => undefined,
  })
  expect(report.canStart).toBe(false)
  expect(report.issues.map((issue) => issue.code)).toEqual(
    expect.arrayContaining([
      'ENVIRONMENT_TRASHED',
      'KERNEL_UNAVAILABLE',
      'CREDENTIAL_UNAVAILABLE',
      'PROXY_UNREACHABLE',
      'NATIVE_MODE',
    ]),
  )
  expect(JSON.stringify(report)).not.toContain('secret-ref')
  expect(record.environmentId).toBe(report.environmentId)
})
it('does not treat an uninstalled provider or missing profile directory as usable', async () => {
  const { record, repository, kernels, dir } = fixture()
  rmSync(dir, { recursive: true })
  const report = await checkEnvironment(
    { ...record, kernelId: 'fingerprint-chromium' },
    repository,
    kernels,
    { read: () => undefined },
  )
  expect(report.issues.map((issue) => issue.code)).toEqual(
    expect.arrayContaining(['KERNEL_UNAVAILABLE', 'DIRECTORY_UNWRITABLE']),
  )
  expect(report.canStart).toBe(false)
})
it('refuses to overwrite a corrupt credential store', () => {
  const { root } = fixture(),
    path = join(root, 'credentials.json')
  writeFileSync(path, 'broken')
  const encrypt = vi.fn(),
    store = createCredentialStore(path, {
      isEncryptionAvailable: () => true,
      encryptString: encrypt,
      decryptString: vi.fn(),
    })
  expect(() => store.save('new', 'password')).toThrow('CREDENTIAL_STORE_UNREADABLE')
  expect(encrypt).not.toHaveBeenCalled()
})
