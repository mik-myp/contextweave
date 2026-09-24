import { z } from 'zod'
import { existsSync, statSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { installBrowserPackage, type InstallProgress } from './kernel-installation'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { KernelRegistry, type LaunchPlan } from '@contextweave/kernel-core'
import {
  createFingerprintChromiumManifest,
  FingerprintChromiumAdapter,
  isFingerprintKernel,
} from '@contextweave/kernel-fingerprint-chromium'
import {
  createStandardChromiumManifest,
  discoverStandardChromiumExecutable,
  StandardChromiumAdapter,
} from '@contextweave/kernel-standard-chromium'
import {
  kernelSummarySchema,
  kernelManifestSchema,
  type KernelCatalog,
  type CustomKernelSource,
  type EnvironmentConfig,
  type KernelSummary,
  type TargetPlatform,
  type TargetArchitecture,
} from '@contextweave/contracts'
import type { EnvironmentRecord, EnvironmentRepository } from '@contextweave/storage'
import {
  bundledRelease,
  fetchOfficialReleases,
  parseOfficialReleases,
  type CatalogEntry,
} from './kernel-catalog'
import { createCustomKernelEntry, publicDownloadSource } from './kernel-custom-source'
import { requireKernelProvider } from './kernel-providers'
const execute = promisify(execFile)

export function createKernelService(
  repository: EnvironmentRepository,
  platform: TargetPlatform,
  arch: TargetArchitecture,
  root?: string,
  changed: () => void = () => {},
) {
  const registry = new KernelRegistry()
  registry.register(new StandardChromiumAdapter(createStandardChromiumManifest(platform, arch)))
  registry.register(
    new FingerprintChromiumAdapter(createFingerprintChromiumManifest(platform, arch)),
  )
  const customEntries = new Map<string, CatalogEntry>()
  let entries: CatalogEntry[] = [bundledRelease(platform, arch)]
  let catalogSource: KernelCatalog['sourceStatus'] = 'bundled'
  let fetchedAt = 0
  let fetching: Promise<void> | undefined
  const cached = repository.getSetting<unknown>('kernel-release-catalog')
  if (cached) {
    try {
      const restored = parseOfficialReleases(cached, platform, arch)
      if (restored.length) {
        entries = restored
        catalogSource = 'cached'
      }
    } catch {
      /* A corrupt optional cache falls back to the bundled manifest. */
    }
  }
  function registerEntries() {
    for (const entry of entries)
      if (
        entry.manifest &&
        !registry.list().some((adapter) => adapter.getManifest().id === entry.manifest!.id)
      )
        registry.register(new FingerprintChromiumAdapter(entry.manifest))
  }
  registerEntries()
  for (const installation of repository.listKernelInstallations()) {
    if (
      installation.platform !== platform ||
      installation.arch !== arch ||
      !isFingerprintKernel(installation.kernelId) ||
      registry.list().some((adapter) => adapter.getManifest().id === installation.kernelId)
    )
      continue
    const manifest = kernelManifestSchema.safeParse(
      repository.getSetting<unknown>(`kernel-manifest:${installation.kernelId}`),
    )
    if (
      manifest.success &&
      manifest.data.id === installation.kernelId &&
      manifest.data.platform === platform &&
      manifest.data.arch === arch &&
      manifest.data.version === installation.version
    )
      registry.register(new FingerprintChromiumAdapter(manifest.data))
  }
  async function catalog(force = false): Promise<KernelCatalog> {
    if (force || Date.now() - fetchedAt > 300_000) {
      fetching ??= (async () => {
        try {
          const raw = await fetchOfficialReleases()
          const next = parseOfficialReleases(raw, platform, arch)
          if (!next.length) throw new Error('CATALOG_UNAVAILABLE')
          entries = next
          catalogSource = 'live'
          registerEntries()
          repository.setSetting('kernel-release-catalog', raw)
        } catch {
          catalogSource = catalogSource === 'bundled' ? 'bundled' : 'cached'
        } finally {
          fetchedAt = Date.now()
          fetching = undefined
        }
      })()
      await fetching
    }
    return {
      sourceStatus: catalogSource,
      releases: [...entries, ...customEntries.values()].map(({ release }) => ({
        ...release,
        installed: Boolean(executableFor({ kernelId: release.id })),
        installation: progress.get(release.id),
      })),
    }
  }
  const jobs = new Map<string, { controller: AbortController; promise: Promise<KernelSummary> }>()
  const progress = new Map<string, InstallProgress>()
  function executableFor(
    record: Pick<EnvironmentRecord, 'kernelId'> & { kernelVersion?: string },
  ): string | undefined {
    const adapter = registry.list().find((adapter) => adapter.getManifest().id === record.kernelId)
    if (!adapter) return undefined
    const manifest = adapter.getManifest()
    if (record.kernelVersion && record.kernelVersion !== manifest.version) return undefined
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
      : record.kernelId === 'standard-chromium'
        ? discoverStandardChromiumExecutable(platform)[0]
        : undefined
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
    return registry
      .list()
      .filter((adapter) => {
        const manifest = adapter.getManifest()
        return Boolean(
          executableFor({ kernelId: manifest.id }) ||
          repository.getKernelInstallation(manifest.id, manifest.version, platform, arch),
        )
      })
      .map((adapter) => {
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
          label:
            manifest.id === 'standard-chromium'
              ? 'Standard Chromium'
              : `Fingerprint Chromium ${manifest.version}`,
          family: manifest.family,
          platform,
          arch,
          version: manifest.version,
          status: executablePath
            ? 'available'
            : manifest.package
              ? 'not-installed'
              : manifest.id === 'standard-chromium'
                ? 'not-configured'
                : 'unsupported',
          executablePath,
          packageAvailable: Boolean(manifest.package),
          source: manifest.source,
          license: manifest.license,
          installation: progress.get(manifest.id),
          unsupportedReason:
            isFingerprintKernel(manifest.id) && !manifest.package
              ? 'PLATFORM_UNSUPPORTED'
              : undefined,
          capabilities: manifest.capabilities,
          providerStatus:
            manifest.id === 'standard-chromium'
              ? 'native'
              : manifest.package
                ? 'verified'
                : 'unconfigured',
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
    proxyArgs?: string[],
  ): LaunchPlan {
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
        proxyArgs:
          proxyArgs ??
          (config.proxy
            ? [`--proxy-server=${config.proxy.type}://${config.proxy.host}:${config.proxy.port}`]
            : []),
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
          ...(isFingerprintKernel(record.kernelId) && config.commonConfig.timezone !== 'system'
            ? [`--timezone=${config.commonConfig.timezone}`]
            : []),
          ...(isFingerprintKernel(record.kernelId) && config.commonConfig.language !== 'system'
            ? [
                `--accept-lang=${[...new Set([config.commonConfig.language, config.commonConfig.language.split('-')[0]])].join(',')}`,
              ]
            : []),
        ],
        kernelArgs: [],
      },
      config.kernelConfig,
    )
  }
  function install(id: string): Promise<KernelSummary> {
    const existing = jobs.get(id)
    if (existing) return existing.promise
    if (jobs.size >= 2) return Promise.reject(new Error('OPERATION_IN_PROGRESS'))
    // A refreshed temporary URL may change while the package identity stays pinned.
    const manifest = customEntries.get(id)?.manifest ?? registry.get(id).getManifest()
    if (!manifest.package || !root) return Promise.reject(new Error('PLATFORM_UNSUPPORTED'))
    if (executableFor({ kernelId: id }))
      return Promise.resolve(list().find((item) => item.id === id)!)
    const controller = new AbortController()
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15 * 60_000)])
    const promise = (async () => {
      try {
        const result = await installBrowserPackage(manifest, root, signal, (value) => {
          progress.set(id, value)
          changed()
        })
        try {
          const storedManifest =
            manifest.sourceType === 'custom'
              ? {
                  ...manifest,
                  package: {
                    ...manifest.package,
                    url: publicDownloadSource(manifest.package!.url!),
                    sizeBytes: result.sizeBytes,
                  },
                }
              : manifest
          repository.setSetting(`kernel-manifest:${id}`, storedManifest)
          repository.recordKernelInstallation({
            kernelId: id,
            version: manifest.version,
            platform,
            arch,
            sourceUrl: publicDownloadSource(manifest.package!.url!),
            sha256: manifest.package!.sha256!,
            installPath: result.installPath,
            state: 'installed',
          })
        } catch (error) {
          await rm(result.installPath, { recursive: true, force: true })
          throw error
        }
        progress.set(id, {
          phase: 'complete',
          receivedBytes: result.sizeBytes,
          totalBytes: result.sizeBytes,
        })
        changed()
        return list().find((item) => item.id === id)!
      } catch (error) {
        const code = controller.signal.aborted
          ? 'CANCELLED'
          : signal.aborted
            ? 'DOWNLOAD_TIMEOUT'
            : error instanceof Error && /^[A-Z_]+$/.test(error.message)
              ? error.message
              : 'INSTALL_FAILED'
        progress.set(id, {
          phase: code === 'CANCELLED' ? 'cancelled' : 'failed',
          receivedBytes: 0,
          totalBytes: manifest.package!.sizeBytes ?? 0,
          errorCode: code,
        })
        changed()
        throw new Error(code)
      } finally {
        jobs.delete(id)
      }
    })()
    jobs.set(id, { controller, promise })
    return promise
  }
  async function prepareCustom(input: CustomKernelSource) {
    requireKernelProvider(input.providerId)
    await catalog()
    const official = entries.find((entry) => entry.manifest?.package?.url === input.url)
    if (official)
      return {
        ...official.release,
        installed: Boolean(executableFor({ kernelId: official.release.id })),
      }
    const entry = createCustomKernelEntry(input, platform, arch)
    const previous = registry
      .list()
      .find((adapter) => adapter.getManifest().id === entry.release.id)
    if (previous && previous.getManifest().package?.sha256 !== entry.manifest!.package!.sha256)
      throw new Error('PACKAGE_HASH_MISMATCH')
    if (!previous) registry.register(new FingerprintChromiumAdapter(entry.manifest!))
    customEntries.set(entry.release.id, entry)
    changed()
    return { ...entry.release, installed: Boolean(executableFor({ kernelId: entry.release.id })) }
  }
  return {
    prepareCustom,
    registry,
    list,
    executableFor,
    buildLaunchPlan,
    observeCdp,
    install,
    catalog,
    cancelInstall: (id: string) => {
      jobs.get(id)?.controller.abort()
      return true
    },
    cancelAll: () => {
      for (const job of jobs.values()) job.controller.abort()
    },
  }
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
