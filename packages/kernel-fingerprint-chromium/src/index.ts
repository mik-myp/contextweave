import { fingerprintIdentitySchema, type FingerprintIdentity, type KernelManifest } from '@contextweave/contracts'
import { buildChromiumArgs, type BrowserKernelAdapter, type LaunchInput, type LaunchPlan } from '@contextweave/kernel-core'

export const fingerprintChromiumConfigSchema = fingerprintIdentitySchema
export type FingerprintChromiumConfig = FingerprintIdentity
export const fingerprintChromiumVersion = '148.0.7778.215'
const releaseRoot = `https://github.com/adryfish/fingerprint-chromium/releases/download/${fingerprintChromiumVersion}`

export function createFingerprintChromiumManifest(platform: KernelManifest['platform'], arch: KernelManifest['arch']): KernelManifest {
  const packageInfo = platform === 'win32' && arch === 'x64'
    ? {
        url: `${releaseRoot}/ungoogled-chromium_148.0.7778.215-1.1_windows_x64.zip`,
        sha256: '9ef3f471b7a6641b4224532522b29141ce3746e27d55788d88e2fd951f362579',
        sizeBytes: 189767686,
      }
    : platform === 'darwin' && arch === 'arm64'
      ? {
          url: `${releaseRoot}/ungoogled-chromium_148.0.7778.215-1.1_macos.dmg`,
          sha256: 'b72f091e2e1a7583eed389c4b8e3534ed355e568af8c8bbf8fc30a25e23ca679',
          sizeBytes: 140187500,
        }
      : undefined
  return {
    id: 'fingerprint-chromium', family: 'chromium', version: fingerprintChromiumVersion, platform, arch,
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
      userDataDir: input.userDataDir, controlPort: input.controlPort,
    }
  }
  getCapabilities() { return this.manifest.capabilities }
}

export function fingerprintKernelId(version: string): string {
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(version)) throw new Error('VERSION_INVALID')
  return `fingerprint-chromium-${version.replaceAll('.', '-')}`
}
export function isFingerprintKernel(id: string): boolean {
  return id === 'fingerprint-chromium' || /^fingerprint-chromium-(?:custom-)?\d+-\d+-\d+-\d+(?:-[0-9a-f]{12})?$/.test(id)
}

export { fingerprintChromiumLicense } from './provider-license'
