import { z } from 'zod'
import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { KernelRegistry, type LaunchPlan } from '@contextweave/kernel-core'
import {
  createFingerprintChromiumManifest,
  FingerprintChromiumAdapter,
} from '@contextweave/kernel-fingerprint-chromium'
import {
  createStandardChromiumManifest,
  discoverStandardChromiumExecutable,
  StandardChromiumAdapter,
} from '@contextweave/kernel-standard-chromium'
import {
  kernelSummarySchema,
  type EnvironmentConfig,
  type KernelSummary,
  type TargetPlatform,
  type TargetArchitecture,
} from '@contextweave/contracts'
import type { EnvironmentRecord, EnvironmentRepository } from '@contextweave/storage'
const execute = promisify(execFile)

export function createKernelService(
  repository: EnvironmentRepository,
  platform: TargetPlatform,
  arch: TargetArchitecture,
) {
  const registry = new KernelRegistry()
  registry.register(new StandardChromiumAdapter(createStandardChromiumManifest(platform, arch)))
  registry.register(
    new FingerprintChromiumAdapter(createFingerprintChromiumManifest(platform, arch)),
  )
  function executableFor(record: Pick<EnvironmentRecord, 'kernelId'>): string | undefined {
    if (record.kernelId !== 'standard-chromium') return undefined
    const manifest = registry.get(record.kernelId).getManifest()
    const installation = repository.getKernelInstallation(
      manifest.id,
      manifest.version,
      platform,
      arch,
    )
    const executable =
      installation?.state === 'installed'
        ? join(installation.installPath, manifest.executable)
        : undefined
    return executable && existsSync(executable)
      ? executable
      : discoverStandardChromiumExecutable(platform)[0]
  }
  const observationSchema = z.object({
    identity: z.string(),
    version: z.string(),
    checkedAt: z.string().datetime(),
  })
  function identity(path: string) {
    const stat = statSync(path)
    return `${path}:${stat.size}:${stat.mtimeMs}`
  }
  function observeCdp(record: EnvironmentRecord, version: string) {
    const executable = executableFor(record)
    if (executable)
      repository.setSetting(`kernel-observation:${record.kernelId}`, {
        identity: identity(executable),
        version,
        checkedAt: new Date().toISOString(),
      })
  }
  function list(): KernelSummary[] {
    return registry.list().map((adapter) => {
      const manifest = adapter.getManifest()
      const executablePath = executableFor({ kernelId: manifest.id })
      const observed = observationSchema.safeParse(
        repository.getSetting<unknown>(`kernel-observation:${manifest.id}`),
      )
      const current =
        observed.success && executablePath && observed.data.identity === identity(executablePath)
          ? observed.data
          : undefined
      return kernelSummarySchema.parse({
        id: manifest.id,
        label: manifest.id === 'standard-chromium' ? 'Standard Chromium' : 'Fingerprint Chromium',
        family: manifest.family,
        platform,
        arch,
        version: manifest.version,
        status: executablePath ? 'available' : 'not-configured',
        executablePath,
        // No full browser-package installer/provider has been qualified in v0.1.
        packageAvailable: false,
        capabilities: manifest.capabilities,
        providerStatus: manifest.id === 'standard-chromium' ? 'native' : 'unconfigured',
        capabilityReport: Object.fromEntries(
          Object.entries(manifest.capabilities).map(([key, declared]) => [
            key,
            {
              declared,
              state: key === 'cdp' && current ? 'verified' : 'unverified',
              ...(key === 'cdp' && current
                ? {
                    version: current.version,
                    checkedAt: current.checkedAt,
                    evidence: 'Managed browser CDP handshake',
                  }
                : {}),
            },
          ]),
        ),
      })
    })
  }
  function buildLaunchPlan(
    record: EnvironmentRecord,
    config: EnvironmentConfig,
    port: number,
  ): LaunchPlan {
    if (record.kernelId !== 'standard-chromium') throw new Error('PROVIDER_UNVERIFIED')
    const adapter = registry.get(record.kernelId)
    const executablePath = executableFor(record)
    if (!executablePath) throw new Error('KERNEL_UNAVAILABLE')
    const validation = adapter.validateConfig(config.kernelConfig)
    if (!validation.ok) throw new Error('CONFIG_INVALID')
    return adapter.buildLaunchPlan(
      {
        environmentId: record.environmentId,
        userDataDir: record.dataDir,
        controlPort: port,
        executablePath,
        proxyArgs: config.proxy
          ? [`--proxy-server=${config.proxy.type}://${config.proxy.host}:${config.proxy.port}`]
          : [],
        commonArgs: [
          ...(config.commonConfig.language === 'system'
            ? []
            : [`--lang=${config.commonConfig.language}`]),
          `--window-size=${config.commonConfig.window.width},${config.commonConfig.window.height}`,
          ...(config.commonConfig.userAgent
            ? [`--user-agent=${config.commonConfig.userAgent}`]
            : []),
          ...(config.commonConfig.webRtcPolicy === 'proxy'
            ? ['--force-webrtc-ip-handling-policy=disable_non_proxied_udp']
            : []),
        ],
        kernelArgs: [],
      },
      config.kernelConfig,
    )
  }
  return { registry, list, executableFor, buildLaunchPlan, observeCdp }
}
export type KernelService = ReturnType<typeof createKernelService>

export async function readExecutableVersion(executable: string): Promise<string | undefined> {
  // Some Windows GUI builds ignore --version and open a default profile. The managed
  // CDP handshake records their actual version after launch instead.
  if (process.platform === 'win32') return undefined
  try {
    const { stdout } = await execute(executable, ['--version'], {
      timeout: 3000,
      maxBuffer: 4096,
      windowsHide: true,
    })
    return stdout.trim().match(/\d+\.\d+\.\d+\.\d+/)?.[0]
  } catch {
    return undefined
  }
}
