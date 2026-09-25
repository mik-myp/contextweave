import { isFingerprintKernel } from '@contextweave/kernel-fingerprint-chromium'
import { randomInt, randomUUID } from 'node:crypto'
import { mkdirSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  createEnvironmentInputSchema,
  environmentConfigSchema,
  type OrphanDirectory,
  type TargetArchitecture,
  type TargetPlatform,
} from '@contextweave/contracts'
import type { EnvironmentRepository } from '@contextweave/storage'
import type { KernelService } from './kernel-service'
import { assertEnvironmentEditable } from '../environment-management'

export function createEnvironmentService(
  repository: EnvironmentRepository,
  kernels: KernelService,
  root: string,
  platform: TargetPlatform,
  arch: TargetArchitecture,
) {
  return {
    create(input: unknown, environmentId = `env-${randomUUID()}`) {
      const parsed = createEnvironmentInputSchema.parse(input)
      const kernel = kernels.list().find((item) => item.id === parsed.kernelId)
      if (
        !kernel ||
        !kernels.hasCompatibleProvider({ kernelId: kernel.id, kernelVersion: kernel.version })
      )
        throw new Error('PROVIDER_UNVERIFIED')
      if (kernel.status !== 'available') throw new Error('KERNEL_UNAVAILABLE')
      const kernelConfig = isFingerprintKernel(kernel.id)
        ? {
            seed: randomInt(1, 4294967296),
            platform: platform === 'win32' ? 'windows' : platform === 'darwin' ? 'macos' : 'linux',
            hardwareConcurrency: 8,
          }
        : parsed.kernelConfig
      if (!kernels.registry.get(kernel.id).validateConfig(kernelConfig).ok)
        throw new Error('CONFIG_INVALID')
      if (parsed.proxy && !parsed.proxyId) throw new Error('Use a saved proxy reference')
      const proxy = parsed.proxyId ? repository.getProxy(parsed.proxyId) : undefined
      if (parsed.proxyId && !proxy) throw new Error('PROXY_MISSING')
      const config = environmentConfigSchema.parse({
        ...parsed,
        environmentId,
        kernelVersion: kernel.version,
        kernelConfig,
        proxy,
      })
      const dataDir = join(root, environmentId)
      mkdirSync(dataDir, { recursive: true })
      return repository.create({ config, dataDir, platform, arch })
    },
    restore(id: string) {
      const record = repository.get(id)
      if (!record || record.lifecycle !== 'trashed') throw new Error('NOT_FOUND')
      assertEnvironmentEditable(repository, record)
      return repository.restoreEnvironment(id)!
    },
    orphans(): OrphanDirectory[] {
      const known = new Set(repository.listAll().map((record) => record.dataDir))
      return readdirSync(root, { withFileTypes: true })
        .filter(
          (entry) =>
            entry.isDirectory() && !entry.isSymbolicLink() && !known.has(join(root, entry.name)),
        )
        .map((entry) => ({
          name: entry.name,
          modifiedAt: statSync(join(root, entry.name)).mtime.toISOString(),
        }))
    },
  }
}
