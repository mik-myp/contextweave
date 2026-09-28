import { fingerprintIdentitySchema, type FingerprintIdentity, type KernelManifest } from '@contextweave/contracts'
import { buildChromiumArgs, type BrowserKernelAdapter, type LaunchInput, type LaunchPlan } from '@contextweave/kernel-core'
import { fingerprintKernelProviderId, fingerprintProviderRelease } from './providers'

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
export class FingerprintChromiumAdapter implements BrowserKernelAdapter<FingerprintChromiumConfig> {
  constructor(private readonly manifest: KernelManifest) {}
  getManifest() { return this.manifest }
  validateConfig(config: unknown) {
    const result = fingerprintChromiumConfigSchema.safeParse(config)
    return result.success ? { ok: true as const } : { ok: false as const, issues: result.error.issues.map((issue) => issue.message) }
  }
  buildLaunchPlan(input: LaunchInput, config: FingerprintChromiumConfig): LaunchPlan {
    if (!this.manifest.package) throw new Error('PLATFORM_UNSUPPORTED')
    const identity = fingerprintChromiumConfigSchema.parse(config)
    return {
      executablePath: input.executablePath,
      args: buildChromiumArgs({ ...input, kernelArgs: [
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
  fingerprintProviderReleases, fingerprintProviders, fingerprintManifestProvider, fingerprintProviderNotice,
} from './providers'
export type { FingerprintProviderRelease } from './providers'

export { fingerprintChromiumLicense } from './provider-license'
