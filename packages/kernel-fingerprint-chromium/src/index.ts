import { fingerprintIdentitySchema, type FingerprintIdentity, type KernelManifest } from '@contextweave/contracts'
import { buildChromiumArgs, type BrowserKernelAdapter, type LaunchInput, type LaunchPlan } from '@contextweave/kernel-core'
import { fingerprintArchiveFormat, fingerprintKernelProviderId, fingerprintManifestProvider, fingerprintProviderRelease } from './providers'

export const fingerprintChromiumConfigSchema = fingerprintIdentitySchema
export type FingerprintChromiumConfig = FingerprintIdentity
export const fingerprintChromiumVersion = '148.0.7778.215'

export function createFingerprintChromiumManifest(platform: KernelManifest['platform'], arch: KernelManifest['arch']): KernelManifest {
  const release = fingerprintProviderRelease('fingerprint-chromium', platform, arch, fingerprintChromiumVersion)
  const packageInfo = release?.admission === 'legacy-candidate' ? { ...release.package } : undefined
  return {
    id: 'fingerprint-chromium', providerId: 'fingerprint-chromium', family: 'chromium', version: fingerprintChromiumVersion, platform, arch,
    executable: platform === 'darwin' ? 'Chromium.app/Contents/MacOS/Chromium' : 'chrome.exe',
    package: packageInfo, controlProtocol: 'cdp',
    capabilities: { cdp: true, screenshot: true, fileUpload: true, elementScreenshot: true, userAgent: true, timezone: true, proxy: true, webRtcPolicy: true },
    configSchema: 'fingerprint-chromium-v2', dataDirCompatibility: [fingerprintChromiumVersion],
    source: 'https://github.com/adryfish/fingerprint-chromium',
    license: 'BSD-3-Clause; Chromium third-party notices included in the upstream package',
  }
}
// Parameter compatibility is not installation or execution admission. Main retains
// its existing source/admission gate; new providers must also match pinned bytes.
function launchProvider(manifest: KernelManifest) {
  const provider = fingerprintManifestProvider(manifest)
  if (provider?.id === 'fingerprint-chromium') {
    // Preserve the pre-v0.3 legacy protocol range without admitting 152 as adryfish.
    if (
      /^\d+\.\d+\.\d+\.\d+$/.test(manifest.version) &&
      [136, 138, 139, 142, 144, 148].includes(Number(manifest.version.split('.')[0]))
    ) {
      return provider
    }
  } else if (
    ((provider?.id === 'fingerprint-chromium-pocchian-intel' && manifest.version === '152.0.7977.82') ||
      (provider?.id === 'fingerprint-chromium-apostate' && manifest.version === '152.0.7977.83')) &&
    fingerprintArchiveFormat(manifest)
  ) {
    return provider
  }
  throw new Error('PROVIDER_UNVERIFIED')
}

function apostateCommonArgs(args: readonly string[]): string[] {
  let language: string | undefined
  let acceptLanguages: string | undefined
  let timezone: string | undefined
  const translated: string[] = []
  for (const arg of args) {
    const separator = arg.indexOf('=')
    const name = separator < 0 ? arg : arg.slice(0, separator)
    const value = separator < 0 ? '' : arg.slice(separator + 1)
    switch (name) {
      case '--lang':
        language = value
        break
      case '--accept-lang':
        acceptLanguages = value
        break
      case '--timezone':
        timezone = value
        break
      default:
        translated.push(arg)
    }
  }
  // An explicit language list wins regardless of switch order. Preserve its
  // bytes: Apostate distinguishes a bare locale from a comma-separated list.
  const locale = acceptLanguages || language
  if (locale) translated.push(`--fingerprint-locale=${locale}`)
  if (timezone) translated.push(`--fingerprint-timezone=${timezone}`)
  return translated
}

export class FingerprintChromiumAdapter implements BrowserKernelAdapter<FingerprintChromiumConfig> {
  constructor(private readonly manifest: KernelManifest) {}
  getManifest() { return this.manifest }
  validateConfig(config: unknown) {
    const result = fingerprintChromiumConfigSchema.safeParse(config)
    return result.success ? { ok: true as const } : { ok: false as const, issues: result.error.issues.map((issue) => issue.message) }
  }
  buildLaunchPlan(input: LaunchInput, config: FingerprintChromiumConfig): LaunchPlan {
    if (!this.manifest.package) throw new Error('PLATFORM_UNSUPPORTED')
    const provider = launchProvider(this.manifest)
    const identity = fingerprintChromiumConfigSchema.parse(config)
    let commonArgs = input.commonArgs
    if (provider.id === 'fingerprint-chromium-apostate') {
      const hostLogicalCores = input.hostLogicalCores
      if (
        hostLogicalCores === undefined || !Number.isSafeInteger(hostLogicalCores) ||
        hostLogicalCores < 1 || identity.hardwareConcurrency > hostLogicalCores
      ) {
        throw new Error('FINGERPRINT_CPU_UNSUPPORTED')
      }
      commonArgs = apostateCommonArgs(commonArgs)
    }
    return {
      executablePath: input.executablePath,
      args: buildChromiumArgs({ ...input, commonArgs, kernelArgs: [
        `--fingerprint=${identity.seed}`,
        `--fingerprint-platform=${identity.platform}`,
        `--fingerprint-hardware-concurrency=${identity.hardwareConcurrency}`,
      ] }),
      userDataDir: input.userDataDir, controlTransport: 'pipe',
    }
  }
  getCapabilities() { return this.manifest.capabilities }
}

export function isFingerprintKernel(id: string): boolean {
  return fingerprintKernelProviderId(id) !== undefined
}

export {
  fingerprintArchiveFormat, fingerprintKernelId, fingerprintKernelProviderId, fingerprintProvider, fingerprintProviderRelease,
  fingerprintProviderReleases, fingerprintProviders, fingerprintManifestProvider, fingerprintProviderNotice, reviewedFingerprintManifests,
} from './providers'
export type { FingerprintProviderRelease } from './providers'

export { fingerprintChromiumLicense } from './provider-license'
