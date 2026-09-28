import { describe, expect, it } from 'vitest'
import type { KernelManifest } from '@contextweave/contracts'
import type { LaunchInput } from '@contextweave/kernel-core'
import { FingerprintChromiumAdapter, createFingerprintChromiumManifest } from './index'
import { fingerprintKernelId, fingerprintProvider, fingerprintProviderRelease } from './providers'

const input: LaunchInput = {
  environmentId: 'env-test',
  userDataDir: '/isolated/data',
  executablePath: 'chromium',
  proxyArgs: [],
  commonArgs: ['--timezone=Asia/Shanghai'],
  kernelArgs: [],
}
const config = { seed: 4294967295, platform: 'macos' as const, hardwareConcurrency: 8 }
const candidates = [
  ['fingerprint-chromium-pocchian-intel', '152.0.7977.82', 'darwin', 'x64'],
  ['fingerprint-chromium-apostate', '152.0.7977.83', 'darwin', 'arm64'],
  ['fingerprint-chromium-apostate', '152.0.7977.83', 'win32', 'x64'],
] as const

type Candidate = readonly [
  providerId: (typeof candidates)[number][0],
  version: string,
  platform: KernelManifest['platform'],
  arch: KernelManifest['arch'],
]
function candidateManifest([providerId, version, platform, arch]: Candidate): KernelManifest {
  const provider = fingerprintProvider(providerId)
  const release = fingerprintProviderRelease(providerId, platform, arch, version)
  if (!provider || !release) throw new Error('Missing fixed candidate fixture')
  return {
    ...createFingerprintChromiumManifest(platform, arch),
    id: fingerprintKernelId(version, providerId),
    providerId,
    version,
    source: provider.source,
    package: { ...release.package },
    dataDirCompatibility: [version],
  }
}

function argsFor(manifest: KernelManifest, launch: LaunchInput = input) {
  return new FingerprintChromiumAdapter(manifest).buildLaunchPlan(launch, config).args
}

describe('fingerprint Chromium legacy adapter', () => {
  it('reuses the persisted seed and only emits real upstream parameters', () => {
    const adapter = new FingerprintChromiumAdapter(
      createFingerprintChromiumManifest('darwin', 'arm64'),
    )
    expect(adapter.buildLaunchPlan(input, config)).toEqual(adapter.buildLaunchPlan(input, config))
    expect(adapter.buildLaunchPlan(input, config).args).toEqual(
      expect.arrayContaining([
        '--fingerprint=4294967295',
        '--fingerprint-platform=macos',
        '--fingerprint-hardware-concurrency=8',
        '--timezone=Asia/Shanghai',
      ]),
    )
    expect(adapter.validateConfig({ ...config, seed: 4294967296 }).ok).toBe(false)
    expect(adapter.validateConfig({ ...config, canvasMode: 'noise' }).ok).toBe(false)
  })

  it('requires an existing stable identity and rejects legacy placeholder settings', () => {
    const adapter = new FingerprintChromiumAdapter(
      createFingerprintChromiumManifest('win32', 'x64'),
    )
    expect(adapter.validateConfig({}).ok).toBe(false)
    expect(adapter.validateConfig({ canvasMode: 'noise' }).ok).toBe(false)
  })

  it.each([
    ['darwin', 'x64'],
    ['win32', 'arm64'],
    ['linux', 'x64'],
  ] as const)('keeps the legacy %s/%s platform unsupported', (platform, arch) => {
    const adapter = new FingerprintChromiumAdapter(
      createFingerprintChromiumManifest(platform, arch),
    )
    expect(adapter.getManifest().package).toBeUndefined()
    expect(() => adapter.buildLaunchPlan(input, config)).toThrow('PLATFORM_UNSUPPORTED')
  })

  it.each([
    ['darwin', 'arm64'],
    ['win32', 'x64'],
  ] as const)(
    'preserves the complete 148 launch plan on %s/%s without a host CPU requirement',
    (platform, arch) => {
      const launch = {
        ...input,
        proxyArgs: ['--proxy-server=http://127.0.0.1:8080'],
        commonArgs: ['--lang=zh-CN', '--accept-lang=zh-CN,zh', '--timezone=Asia/Shanghai'],
        hostLogicalCores: 0,
      }
      const manifest = createFingerprintChromiumManifest(platform, arch)
      const adapter = new FingerprintChromiumAdapter(manifest)
      expect(adapter.buildLaunchPlan(launch, config)).toEqual({
        executablePath: input.executablePath,
        userDataDir: input.userDataDir,
        controlTransport: 'pipe',
        args: [
          '--user-data-dir=/isolated/data',
          '--remote-debugging-pipe',
          '--no-first-run',
          '--no-default-browser-check',
          '--restore-last-session',
          '--disable-background-mode',
          '--disable-features=Translate',
          ...launch.proxyArgs,
          ...launch.commonArgs,
          '--fingerprint=4294967295',
          '--fingerprint-platform=macos',
          '--fingerprint-hardware-concurrency=8',
        ],
      })
      const original = adapter.buildLaunchPlan(launch, config).args
      delete manifest.providerId
      expect(argsFor(manifest, launch)).toEqual(original)
    },
  )

  it.each([136, 138, 139, 142, 144, 148])(
    'keeps the existing legacy major %s protocol range',
    (major) => {
      const manifest = {
        ...createFingerprintChromiumManifest('win32', 'x64'),
        version: `${major}.0.0.1`,
      }
      expect(argsFor(manifest)).toContain('--fingerprint=4294967295')
    },
  )

  it('preserves the existing explicitly trusted 148 custom-source namespace', () => {
    const manifest = createFingerprintChromiumManifest('win32', 'x64')
    const original = argsFor(manifest)
    manifest.id = 'fingerprint-chromium-custom-148-0-7778-215-9ef3f471b7a6'
    manifest.sourceType = 'custom'
    manifest.source = 'https://mirror.example.test/chromium.zip'
    expect(argsFor(manifest)).toEqual(original)
  })
})

describe.each(candidates)(
  '%s %s on %s/%s parameter contract',
  (providerId, version, platform, arch) => {
    const manifest = () => candidateManifest([providerId, version, platform, arch])
    const launch = { ...input, hostLogicalCores: 64 }

    it.each([1, 2147483647, 2147483648, 4294967295])('preserves decimal seed %s', (seed) => {
      const adapter = new FingerprintChromiumAdapter(manifest())
      const identity = Object.freeze({ ...config, seed })
      const plan = adapter.buildLaunchPlan(launch, identity)
      expect(plan.args.filter((arg) => arg.startsWith('--fingerprint='))).toEqual([
        `--fingerprint=${seed}`,
      ])
      expect(adapter.buildLaunchPlan(launch, identity)).toEqual(plan)
      expect(identity).toEqual({ ...config, seed })
      expect(plan.userDataDir).toBe(input.userDataDir)
      expect(plan.controlTransport).toBe('pipe')
      expect(plan.args).toContain('--remote-debugging-pipe')
      expect(
        plan.args.some((arg) =>
          /^--(?:profile(?:-json)?|apostate-profile|fingerprint-noise)(?:=|$)/.test(arg),
        ),
      ).toBe(false)
    })

    it.each(['windows', 'macos', 'linux'] as const)('preserves persona %s', (persona) => {
      const plan = new FingerprintChromiumAdapter(manifest()).buildLaunchPlan(launch, {
        ...config,
        platform: persona,
      })
      expect(plan.args).toContain(`--fingerprint-platform=${persona}`)
    })

    it.each([1, 8, 64])('preserves requested hardware concurrency %s', (hardwareConcurrency) => {
      const plan = new FingerprintChromiumAdapter(manifest()).buildLaunchPlan(launch, {
        ...config,
        hardwareConcurrency,
      })
      expect(plan.args).toContain(`--fingerprint-hardware-concurrency=${hardwareConcurrency}`)
    })

    it.each([
      { seed: 0 },
      { seed: -1 },
      { seed: 4294967296 },
      { seed: 1.5 },
      { platform: 'Windows' },
      { hardwareConcurrency: 0 },
      { hardwareConcurrency: 65 },
      { hardwareConcurrency: 1.5 },
      { profile: 'profile.json' },
      { noise: true },
    ])('does not expand the persisted identity schema: %j', (change) => {
      expect(
        new FingerprintChromiumAdapter(manifest()).validateConfig({ ...config, ...change }).ok,
      ).toBe(false)
    })

    it('does not mutate caller arguments or provider admission metadata', () => {
      const metadata = () => ({
        provider: fingerprintProvider(providerId),
        release: fingerprintProviderRelease(providerId, platform, arch, version),
      })
      const originalMetadata = structuredClone(metadata())
      const immutableInput = {
        ...launch,
        commonArgs: [...launch.commonArgs],
        proxyArgs: ['--proxy-server=http://127.0.0.1:8080'],
        kernelArgs: [],
      }
      Object.freeze(immutableInput.commonArgs)
      Object.freeze(immutableInput.proxyArgs)
      Object.freeze(immutableInput.kernelArgs)
      Object.freeze(immutableInput)
      const plan = new FingerprintChromiumAdapter(manifest()).buildLaunchPlan(
        immutableInput,
        config,
      )
      expect(immutableInput.commonArgs).toEqual(input.commonArgs)
      expect(plan.args).toContain(immutableInput.proxyArgs[0])
      expect(metadata()).toEqual(originalMetadata)
    })

    it.each([
      { providerId: 'unknown-provider' },
      { providerId: undefined },
      { providerId: 'fingerprint-chromium' },
      { version: '153.0.0.0' },
      { source: 'https://example.test/other-provider' },
      { sourceType: 'custom' as const },
      { id: 'fingerprint-chromium' },
      { platform: 'linux' as const },
    ])('refuses an unrecognized or mismatched provider/release: %j', (change) => {
      expect(() => argsFor({ ...manifest(), ...change }, launch)).toThrow('PROVIDER_UNVERIFIED')
    })

    it.each([
      { url: 'https://example.test/other.zip' },
      { sha256: 'f'.repeat(64) },
      { sha256: undefined },
      { sizeBytes: 1 },
    ])('does not accept an unpinned candidate package: %j', (change) => {
      const value = manifest()
      value.package = { ...value.package, ...change }
      expect(() => argsFor(value, launch)).toThrow('PROVIDER_UNVERIFIED')
    })

    it('retains the control transport override guard', () => {
      expect(() =>
        argsFor(manifest(), { ...launch, commonArgs: ['--remote-debugging-port=9222'] }),
      ).toThrow('CONTROL_TRANSPORT_OVERRIDE')
    })
  },
)

describe('Intel 152 compatibility', () => {
  it.each([undefined, 0, 4, Number.NaN])(
    'does not require or clamp to host CPU value %s',
    (hostLogicalCores) => {
      const commonArgs = ['--lang=zh-CN', '--accept-lang=zh-CN,zh', '--timezone=Asia/Shanghai']
      const args = argsFor(candidateManifest(candidates[0]), {
        ...input,
        commonArgs,
        hostLogicalCores,
      })
      expect(args).toEqual(expect.arrayContaining(commonArgs))
      expect(args).toContain('--fingerprint-hardware-concurrency=8')
      expect(args.some((arg) => /^--fingerprint-(?:locale|timezone)=/.test(arg))).toBe(false)
    },
  )
})

describe.each([candidates[1], candidates[2]])(
  'Apostate CPU/locale on %s %s %s/%s',
  (...candidate) => {
    const manifest = () => candidateManifest(candidate)

    it.each([
      undefined,
      0,
      -1,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      Number.MAX_SAFE_INTEGER + 1,
    ])('rejects missing/invalid host logical core count %s', (hostLogicalCores) => {
      expect(() => argsFor(manifest(), { ...input, hostLogicalCores })).toThrow(
        new Error('FINGERPRINT_CPU_UNSUPPORTED'),
      )
    })

    it('refuses a CPU overclaim without changing persisted identity', () => {
      const identity = Object.freeze({ ...config })
      const adapter = new FingerprintChromiumAdapter(manifest())
      expect(adapter.validateConfig(identity).ok).toBe(true)
      expect(() => adapter.buildLaunchPlan({ ...input, hostLogicalCores: 4 }, identity)).toThrow(
        new Error('FINGERPRINT_CPU_UNSUPPORTED'),
      )
      expect(identity).toEqual(config)
      expect(adapter.buildLaunchPlan({ ...input, hostLogicalCores: 8 }, identity).args).toContain(
        '--fingerprint-hardware-concurrency=8',
      )
    })

    it.each([
      {
        common: ['--lang=en-US', '--accept-lang=zh-CN,zh', '--timezone=Asia/Shanghai'],
        mapped: ['--fingerprint-locale=zh-CN,zh', '--fingerprint-timezone=Asia/Shanghai'],
      },
      {
        common: ['--accept-lang=zh-CN,zh', '--lang=en-US'],
        mapped: ['--fingerprint-locale=zh-CN,zh'],
      },
      { common: ['--lang=de-DE'], mapped: ['--fingerprint-locale=de-DE'] },
      { common: ['--timezone=Europe/London'], mapped: ['--fingerprint-timezone=Europe/London'] },
      { common: ['--lang=zh-CN', '--accept-lang='], mapped: ['--fingerprint-locale=zh-CN'] },
      { common: ['--lang', '--accept-lang=', '--timezone='], mapped: [] },
      {
        common: [
          '--lang=en-US',
          '--accept-lang=en-US,en',
          '--accept-lang=fr-FR,fr',
          '--timezone=UTC',
          '--timezone=Europe/Paris',
        ],
        mapped: ['--fingerprint-locale=fr-FR,fr', '--fingerprint-timezone=Europe/Paris'],
      },
      { common: [], mapped: [] },
    ])('maps only supplied language/timezone values: $common', ({ common, mapped }) => {
      const unrelated = ['--user-agent=fixture', '--lang-extra=keep', '--timezone-extra=keep']
      const commonArgs = [...unrelated, ...common]
      const original = [...commonArgs]
      const args = argsFor(manifest(), { ...input, hostLogicalCores: 8, commonArgs })
      expect(args.filter((arg) => /^--fingerprint-(?:locale|timezone)=/.test(arg))).toEqual(mapped)
      expect(args.some((arg) => /^--(?:accept-lang|lang|timezone)(?:=|$)/.test(arg))).toBe(false)
      expect(args).toEqual(expect.arrayContaining(unrelated))
      expect(commonArgs).toEqual(original)
    })
  },
)

it.each(['152.0.7977.83', '999.0.0.1', 'not-a-version'])(
  'does not route unknown legacy version %s through new provider support',
  (version) => {
    const manifest = { ...createFingerprintChromiumManifest('win32', 'x64'), version }
    expect(() => argsFor(manifest)).toThrow('PROVIDER_UNVERIFIED')
  },
)
