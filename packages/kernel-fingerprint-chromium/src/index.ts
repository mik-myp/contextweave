import { z } from 'zod'
import type { KernelManifest } from '@contextweave/contracts'
import {
  type BrowserKernelAdapter,
  type LaunchInput,
  type LaunchPlan,
} from '@contextweave/kernel-core'

export const fingerprintChromiumConfigSchema = z.object({
  platform: z.string().trim().min(1).default('win32'),
  canvasMode: z.enum(['default', 'noise', 'off']).default('default'),
  audioMode: z.enum(['default', 'noise', 'off']).default('default'),
  webglMode: z.enum(['default', 'noise', 'off']).default('default'),
})
export type FingerprintChromiumConfig = z.infer<typeof fingerprintChromiumConfigSchema>

export function createFingerprintChromiumManifest(
  platform: KernelManifest['platform'],
  arch: KernelManifest['arch'],
): KernelManifest {
  return {
    id: 'fingerprint-chromium',
    family: 'chromium',
    version: 'unconfigured',
    platform,
    arch,
    executable: platform === 'win32' ? 'chrome.exe' : 'chrome',
    controlProtocol: 'cdp',
    capabilities: {
      cdp: false,
      screenshot: false,
      fileUpload: false,
      elementScreenshot: false,
      userAgent: false,
      timezone: false,
      proxy: false,
      webRtcPolicy: false,
    },
    configSchema: 'fingerprint-chromium-v1',
    dataDirCompatibility: [],
    license: 'Unverified - configure a licensed manifest before release',
  }
}

export class FingerprintChromiumAdapter implements BrowserKernelAdapter<FingerprintChromiumConfig> {
  constructor(private readonly manifest: KernelManifest) {}

  getManifest(): KernelManifest {
    return this.manifest
  }

  validateConfig(config: unknown) {
    const result = fingerprintChromiumConfigSchema.safeParse(config)
    return result.success
      ? { ok: true as const }
      : { ok: false as const, issues: result.error.issues.map((issue) => issue.message) }
  }

  buildLaunchPlan(_input: LaunchInput, _config: FingerprintChromiumConfig): LaunchPlan {
    throw new Error(
      'PROVIDER_UNVERIFIED: fingerprint-chromium has no qualified provider; placeholder arguments are not executable capabilities',
    )
  }

  getCapabilities() {
    return this.manifest.capabilities
  }
}
