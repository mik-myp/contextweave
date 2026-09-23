import { z } from 'zod'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { KernelManifest } from '@contextweave/contracts'
import {
  buildChromiumArgs,
  type BrowserKernelAdapter,
  type LaunchInput,
  type LaunchPlan,
} from '@contextweave/kernel-core'

const standardChromiumConfigSchema = z.object({ userAgent: z.string().min(1).optional() }).strict()
export type StandardChromiumConfig = z.infer<typeof standardChromiumConfigSchema>

export function createStandardChromiumManifest(
  platform: KernelManifest['platform'],
  arch: KernelManifest['arch'],
): KernelManifest {
  return {
    id: 'standard-chromium',
    family: 'chromium',
    version: 'local',
    platform,
    arch,
    executable: platform === 'win32' ? 'chrome.exe' : 'chrome',
    controlProtocol: 'cdp',
    capabilities: {
      cdp: true,
      screenshot: true,
      fileUpload: true,
      elementScreenshot: true,
      userAgent: true,
      timezone: true,
      proxy: true,
      webRtcPolicy: true,
    },
    configSchema: 'standard-chromium-v1',
    dataDirCompatibility: ['local'],
    license: 'User-provided or separately licensed Chromium-compatible binary',
  }
}

export function discoverStandardChromiumExecutable(
  platform: NodeJS.Platform,
  env = process.env,
): string[] {
  const candidates: string[] = []
  if (platform === 'win32') {
    for (const root of [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA]) {
      if (!root) continue
      candidates.push(
        join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        join(root, 'Chromium', 'Application', 'chrome.exe'),
      )
    }
  } else if (platform === 'darwin') {
    candidates.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    )
  } else {
    candidates.push('/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/microsoft-edge')
  }
  return candidates.filter(existsSync)
}

export class StandardChromiumAdapter implements BrowserKernelAdapter<StandardChromiumConfig> {
  constructor(private readonly manifest: KernelManifest) {}

  getManifest(): KernelManifest {
    return this.manifest
  }

  validateConfig(config: unknown) {
    if (standardChromiumConfigSchema.safeParse(config ?? {}).success) return { ok: true as const }
    return { ok: false as const, issues: ['Standard Chromium configuration must be an object'] }
  }

  buildLaunchPlan(input: LaunchInput, config: StandardChromiumConfig): LaunchPlan {
    const commonArgs = [
      ...input.commonArgs,
      ...(config.userAgent ? [`--user-agent=${config.userAgent}`] : []),
    ]
    return {
      executablePath: input.executablePath,
      args: buildChromiumArgs({ ...input, commonArgs, kernelArgs: [] }),
      userDataDir: input.userDataDir,
      controlPort: input.controlPort,
    }
  }

  getCapabilities() {
    return this.manifest.capabilities
  }
}
