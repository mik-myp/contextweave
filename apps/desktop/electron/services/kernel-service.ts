import { probeKernelCapabilities } from './kernel-capability-probe'
import {
  capabilityEvidenceSchema,
  renameKernelSchema,
  installKernelSchema,
} from '@contextweave/contracts'
import { cpus } from 'node:os'
import { KernelDmgCleanupError } from './kernel-dmg'
import { validateKernelRemovalPath } from './kernel-removal'
import { assertEnvironmentEditable } from '../environment-management'
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
  fingerprintKernelProviderId,
  fingerprintProvider,
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
  reviewedReleases,
  isPinnedOfficialPackage,
  fetchOfficialReleases,
  parseOfficialReleases,
  type CatalogEntry,
} from './kernel-catalog'
import { createCustomKernelEntry, publicDownloadSource } from './kernel-custom-source'
import { isCompatibleFingerprintManifest, requireKernelProvider } from './kernel-providers'
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
  const reviewed = reviewedReleases(platform, arch)
  let entries: CatalogEntry[] = [...reviewed, bundledRelease(platform, arch)]
  let catalogSource: KernelCatalog['sourceStatus'] = 'bundled'
  let fetchedAt = 0
  let fetching: Promise<void> | undefined
  const cached = repository.getSetting<unknown>('kernel-release-catalog')
  if (cached) {
    try {
      const restored = parseOfficialReleases(cached, platform, arch)
      if (restored.length) {
        entries = [...reviewed, ...restored]
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
  // A stopped environment may retain a pinned version after its package is deleted.
  const knownVersions = [
    ...repository.listKernelInstallations(),
    ...repository.listAll().map((record) => ({ ...record, version: record.kernelVersion })),
  ]
  for (const installation of knownVersions) {
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
          entries = [...reviewed, ...next]
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
    const availableEntries = [...entries, ...customEntries.values()]
    const referenced = new Set(repository.listAll().map((record) => record.kernelId))
    // Keep pinned official identities selectable even when upstream's recent-release
    // window no longer lists them, including the legacy unversioned kernel ID.
    for (const adapter of registry.list()) {
      const manifest = adapter.getManifest()
      if (
        !referenced.has(manifest.id) ||
        !manifest.source ||
        !manifest.package?.url ||
        !manifest.package.sha256 ||
        manifest.sourceType === 'custom' ||
        availableEntries.some((entry) => entry.release.id === manifest.id)
      )
        continue
      availableEntries.push({
        manifest,
        release: {
          id: manifest.id,
          provider: fingerprintKernelProviderId(manifest.id) ?? 'fingerprint-chromium',
          version: manifest.version,
          platform,
          arch,
          source: manifest.source,
          sizeBytes: manifest.package.sizeBytes,
          sha256: manifest.package.sha256,
          installable: isPinnedOfficialPackage(manifest),
          reason: isPinnedOfficialPackage(manifest) ? undefined : 'RELEASE_UNREVIEWED',
          installed: false,
          retained: true,
        },
      })
    }
    return {
      sourceStatus: catalogSource,
      releases: availableEntries.map(({ release }) => ({
        ...release,
        installed: Boolean(executableFor({ kernelId: release.id })),
        installation: progress.get(release.id),
      })),
    }
  }
  const jobs = new Map<string, { controller: AbortController; promise: Promise<KernelSummary> }>()
  const progress = new Map<string, InstallProgress>()
  const removals = new Set<string>()
  const probing = new Map<
    string,
    { controller: AbortController; promise: Promise<KernelSummary> }
  >()
  const probeStates = new Map<string, NonNullable<KernelSummary['verification']>>()
  const cleanupBlocked = new Set<string>()
  const users = new Map<string, number>()
  function installationFor(id: string) {
    const manifest = registry
      .list()
      .find((adapter) => adapter.getManifest().id === id)
      ?.getManifest()
    return manifest
      ? repository.getKernelInstallation(id, manifest.version, platform, arch)
      : undefined
  }
  function retain(id: string): () => void {
    if (removals.has(id) || jobs.has(id) || probing.has(id) || cleanupBlocked.has(id))
      throw new Error('OPERATION_IN_PROGRESS')
    if (installationFor(id)?.state === 'removing') throw new Error('KERNEL_REMOVAL_PENDING')
    users.set(id, (users.get(id) ?? 0) + 1)
    let released = false
    return () => {
      if (released) return
      released = true
      const count = (users.get(id) ?? 1) - 1
      if (count) users.set(id, count)
      else users.delete(id)
    }
  }
  async function remove(id: string): Promise<boolean> {
    if (
      removals.has(id) ||
      jobs.has(id) ||
      probing.has(id) ||
      cleanupBlocked.has(id) ||
      users.has(id)
    )
      throw new Error('OPERATION_IN_PROGRESS')
    const installation = installationFor(id)
    if (!root || !installation || !isFingerprintKernel(id)) throw new Error('KERNEL_NOT_MANAGED')
    // Both active and trashed configurations can own a profile/process.
    for (const record of repository.listAll().filter((item) => item.kernelId === id)) {
      try {
        assertEnvironmentEditable(repository, record)
      } catch (error) {
        if (error instanceof Error && error.message === 'ENVIRONMENT_BUSY')
          // eslint-disable-next-line preserve-caught-error -- This public operation remaps a fixed busy code without retaining process/path context.
          throw new Error('KERNEL_IN_USE')
        throw error
      }
    }
    removals.add(id) // Before the first await: launch and install cannot pass this fence.
    try {
      const path = await validateKernelRemovalPath(root, installation)
      repository.markKernelRemoving(installation.id)
      changed()
      try {
        await rm(path, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 })
        repository.deleteKernelInstallation(installation.id)
      } catch {
        throw new Error('KERNEL_REMOVE_FAILED')
      }
      progress.delete(id)
      changed()
      return true
    } finally {
      removals.delete(id)
    }
  }
  function hasCompatibleProvider(
    record: Pick<EnvironmentRecord, 'kernelId'> & { kernelVersion?: string },
  ): boolean {
    const adapter = registry.list().find((item) => item.getManifest().id === record.kernelId)
    if (!adapter) return false
    const manifest = adapter.getManifest()
    if (
      manifest.platform !== platform ||
      manifest.arch !== arch ||
      (record.kernelVersion && record.kernelVersion !== manifest.version)
    )
      return false
    if (adapter instanceof StandardChromiumAdapter) return manifest.id === 'standard-chromium'
    return (
      adapter instanceof FingerprintChromiumAdapter && isCompatibleFingerprintManifest(manifest)
    )
  }
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
    // macOS updates usage metadata (ctime) when launching a binary; that is not a content change.
    return `${path}:${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}`
  }
  const probeSchema = z.object({
    identity: z.string(),
    report: z.record(z.string(), capabilityEvidenceSchema),
  })
  function rename(input: z.infer<typeof renameKernelSchema>) {
    const value = renameKernelSchema.parse(input)
    if (!list().some((item) => item.id === value.id)) throw new Error('KERNEL_UNAVAILABLE')
    repository.setSetting(`kernel-name:${value.id}`, value.name)
    changed()
    return list().find((item) => item.id === value.id)!
  }
  async function runProbe(id: string, signal: AbortSignal) {
    const executable = executableFor({ kernelId: id })
    if (!executable) throw new Error('KERNEL_UNAVAILABLE')
    const before = identity(executable)
    const manifest = registry.get(id).getManifest()
    probeStates.set(id, { state: 'running' })
    changed()
    try {
      const result = await probeKernelCapabilities(executable, manifest.capabilities, signal)
      signal.throwIfAborted()
      if (identity(executable) !== before) throw new Error('KERNEL_CHANGED')
      repository.setSetting(
        `kernel-capability-probe:${id}`,
        probeSchema.parse({ identity: before, report: result.report }),
      )
      probeStates.set(id, { state: 'complete' })
    } catch (error) {
      const errorCode =
        error instanceof Error &&
        ['KERNEL_PROBE_CLEANUP_FAILED', 'KERNEL_CHANGED'].includes(error.message)
          ? error.message
          : signal.aborted
            ? 'CANCELLED'
            : 'KERNEL_PROBE_FAILED'
      if (errorCode === 'KERNEL_PROBE_CLEANUP_FAILED') cleanupBlocked.add(id)
      probeStates.set(id, { state: 'failed', errorCode })
      // Installation remains usable; failed detection never invents verified evidence.
      if (!signal.aborted)
        repository.setSetting(`kernel-capability-probe:${id}`, {
          identity: before,
          report: {
            cdp: {
              declared: manifest.capabilities.cdp,
              state: 'failed',
              checkedAt: new Date().toISOString(),
            },
          },
        })
    } finally {
      changed()
    }
    return list().find((item) => item.id === id)!
  }
  function verify(id: string): Promise<KernelSummary> {
    if (probing.has(id)) return probing.get(id)!.promise
    if (
      probing.size >= 2 ||
      removals.has(id) ||
      jobs.has(id) ||
      users.has(id) ||
      cleanupBlocked.has(id)
    )
      return Promise.reject(new Error('OPERATION_IN_PROGRESS'))
    const controller = new AbortController()
    const promise = runProbe(id, controller.signal).finally(() => probing.delete(id))
    probing.set(id, { controller, promise })
    return promise
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
        const named = renameKernelSchema.shape.name.safeParse(
          repository.getSetting<unknown>(`kernel-name:${manifest.id}`),
        )
        const customName = named.success && named.data ? named.data : undefined
        const probe = probeSchema.safeParse(
          repository.getSetting<unknown>(`kernel-capability-probe:${manifest.id}`),
        )
        const proof =
          probe.success && executablePath && probe.data.identity === identity(executablePath)
            ? probe.data.report
            : {}
        return kernelSummarySchema.parse({
          id: manifest.id,
          customName,
          verification: probeStates.get(manifest.id),
          label:
            customName ??
            (manifest.id === 'standard-chromium'
              ? 'Standard Chromium'
              : `${fingerprintProvider(fingerprintKernelProviderId(manifest.id) ?? '')?.label ?? 'Fingerprint Chromium'} ${manifest.version}`),
          family: manifest.family,
          platform,
          arch,
          version: manifest.version,
          removable: Boolean(
            root && isFingerprintKernel(manifest.id) && installationFor(manifest.id),
          ),
          removalPending: installationFor(manifest.id)?.state === 'removing',
          referenceCount: repository.listAll().filter((record) => record.kernelId === manifest.id)
            .length,
          status:
            installationFor(manifest.id)?.state === 'removing'
              ? 'removal-pending'
              : executablePath
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
                ? 'candidate'
                : 'unconfigured',
          capabilityReport: Object.fromEntries(
            Object.entries(manifest.capabilities).map(([key, declared]) => [
              key,
              !declared
                ? { declared, state: 'unsupported' }
                : key === 'cdp' &&
                    current &&
                    (!proof[key]?.checkedAt || current.checkedAt >= proof[key].checkedAt)
                  ? {
                      declared,
                      state: 'verified',
                      version: current.version,
                      checkedAt: current.checkedAt,
                      evidence: 'Managed browser CDP handshake',
                    }
                  : (proof[key] ?? { declared, state: 'unverified' }),
            ]),
          ),
        })
      })
  }
  function buildLaunchPlan(
    record: EnvironmentRecord,
    config: EnvironmentConfig,
    proxyArgs?: string[],
  ): LaunchPlan {
    if (config.commonConfig.language === 'auto' || config.commonConfig.timezone === 'auto')
      throw new Error('IP_LOCALE_FAILED')
    if (!hasCompatibleProvider(record)) throw new Error('PROVIDER_UNVERIFIED')
    const adapter = registry.get(record.kernelId)
    const executablePath = executableFor(record)
    if (!executablePath) throw new Error('KERNEL_UNAVAILABLE')
    const validation = adapter.validateConfig(config.kernelConfig)
    if (!validation.ok) throw new Error('CONFIG_INVALID')
    return adapter.buildLaunchPlan(
      {
        environmentId: record.environmentId,
        userDataDir: record.dataDir,
        executablePath,
        hostLogicalCores: cpus().length,
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
  function install(id: string, name?: string): Promise<KernelSummary> {
    const input = installKernelSchema.parse({ id, name })
    if (removals.has(id) || users.has(id) || probing.has(id) || cleanupBlocked.has(id))
      return Promise.reject(new Error('OPERATION_IN_PROGRESS'))
    if (installationFor(id)?.state === 'removing')
      return Promise.reject(new Error('KERNEL_REMOVAL_PENDING'))
    const existing = jobs.get(id)
    if (existing) return existing.promise
    if (jobs.size >= 2) return Promise.reject(new Error('OPERATION_IN_PROGRESS'))
    // A refreshed temporary URL may change while the package identity stays pinned.
    const manifest = customEntries.get(id)?.manifest ?? registry.get(id).getManifest()
    if (!manifest.package || !root) return Promise.reject(new Error('PLATFORM_UNSUPPORTED'))
    if (!isCompatibleFingerprintManifest(manifest))
      return Promise.reject(new Error('PROVIDER_UNVERIFIED'))
    if (executableFor({ kernelId: id }))
      return Promise.resolve(list().find((item) => item.id === id)!)
    if (manifest.sourceType !== 'custom' && !isPinnedOfficialPackage(manifest))
      return Promise.reject(new Error('RELEASE_UNREVIEWED'))
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
          repository.commitKernelInstallation(
            {
              kernelId: id,
              version: manifest.version,
              platform,
              arch,
              sourceUrl: publicDownloadSource(manifest.package!.url!),
              sha256: manifest.package!.sha256!,
              installPath: result.installPath,
              state: 'installed',
            },
            storedManifest,
            input.name,
          )
        } catch (error) {
          await rm(result.installPath, { recursive: true, force: true })
          throw error
        }
        progress.set(id, {
          phase: 'testing',
          receivedBytes: result.sizeBytes,
          totalBytes: result.sizeBytes,
        })
        changed()
        await runProbe(id, signal)
        progress.set(id, {
          phase: 'complete',
          receivedBytes: result.sizeBytes,
          totalBytes: result.sizeBytes,
        })
        changed()
        return list().find((item) => item.id === id)!
      } catch (error) {
        const code =
          error instanceof KernelDmgCleanupError
            ? 'ARCHIVE_UNMOUNT_FAILED'
            : controller.signal.aborted
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
        // eslint-disable-next-line preserve-caught-error -- Download and extraction exceptions may contain credentials/URLs/paths; keep only the validated code.
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
    const official = entries.find(
      (entry) =>
        entry.release.provider === input.providerId && entry.manifest?.package?.url === input.url,
    )
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
    rename,
    verify,
    hasActive: () => jobs.size > 0 || probing.size > 0,
    drain: () => Promise.allSettled([...probing.values()].map((job) => job.promise)),
    prepareCustom,
    remove,
    retain,
    registry,
    list,
    executableFor,
    hasCompatibleProvider,
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
      for (const job of probing.values()) job.controller.abort()
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
