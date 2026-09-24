import type {
  KernelCapabilities,
  KernelManifest,
  TargetArchitecture,
  TargetPlatform,
} from '@contextweave/contracts'

export type LaunchInput = {
  environmentId: string
  userDataDir: string
  controlPort: number
  executablePath: string
  proxyArgs: string[]
  commonArgs: string[]
  kernelArgs: string[]
}

export type LaunchPlan = {
  executablePath: string
  args: string[]
  userDataDir: string
  controlPort: number
}

export type ConfigValidationResult = { ok: true } | { ok: false; issues: string[] }

export interface BrowserKernelAdapter<TConfig = unknown> {
  getManifest(): KernelManifest
  validateConfig(config: unknown): ConfigValidationResult
  buildLaunchPlan(input: LaunchInput, config: TConfig): LaunchPlan
  getCapabilities(): KernelCapabilities
}

export type KernelDescriptor = {
  id: string
  label: string
  family: KernelManifest['family']
  platform: TargetPlatform
  arch: TargetArchitecture
  version: string
  status: 'available' | 'not-installed' | 'unsupported'
  executablePath?: string
  capabilities: KernelCapabilities
}

export class KernelRegistry {
  private readonly adapters = new Map<string, BrowserKernelAdapter>()

  register(adapter: BrowserKernelAdapter): void {
    const id = adapter.getManifest().id
    if (this.adapters.has(id)) {
      throw new Error(`Kernel adapter already registered: ${id}`)
    }
    this.adapters.set(id, adapter)
  }

  get(id: string): BrowserKernelAdapter {
    const adapter = this.adapters.get(id)
    if (!adapter) {
      throw new Error(`Kernel adapter not found: ${id}`)
    }
    return adapter
  }

  list(): BrowserKernelAdapter[] {
    return [...this.adapters.values()]
  }
}

export function buildChromiumArgs(input: LaunchInput): string[] {
  return [
    `--user-data-dir=${input.userDataDir}`,
    `--remote-debugging-port=${input.controlPort}`,
    '--remote-debugging-address=127.0.0.1',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-features=Translate',
    ...input.proxyArgs,
    ...input.commonArgs,
    ...input.kernelArgs,
  ]
}
