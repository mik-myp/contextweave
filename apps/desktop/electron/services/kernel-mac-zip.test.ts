import { createWriteStream } from 'node:fs'
import { lstat, mkdir, mkdtemp, readFile, readdir, readlink, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateRawSync } from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { KernelManifest } from '@contextweave/contracts'
import {
  createFingerprintChromiumManifest,
  fingerprintArchiveFormat,
  fingerprintKernelId,
  fingerprintProvider,
  fingerprintProviderRelease,
} from '@contextweave/kernel-fingerprint-chromium'
import { extractBrowserArchive, extractZip } from './kernel-archive'
import { withKernelDmg } from './kernel-dmg'

vi.mock('./kernel-dmg', () => ({ withKernelDmg: vi.fn() }))
vi.mock('node:fs', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs')>()
  return { ...fs, createWriteStream: vi.fn(fs.createWriteStream) }
})

interface FixtureEntry {
  name: string
  data?: string | Buffer
  mode?: number
  size?: number
  deflated?: boolean
}
const roots: string[] = []
const signal = () => new AbortController().signal
const executable = 'Chromium.app/Contents/MacOS/Chromium'
const framework = 'Chromium.app/Contents/Frameworks/Chromium Framework.framework'
const version = '152.0.7977.83'
const packageEntries: FixtureEntry[] = [
  { name: executable, data: 'inert executable fixture', mode: 0o100755 },
  { name: 'LICENSE', data: 'complete license fixture' },
  { name: 'build/MANIFEST.lock', data: 'build record fixture', deflated: true },
  { name: 'resources/profiles/catalogue.json', data: '{"fixture":true}' },
]
const link = (name: string, target: string | Buffer): FixtureEntry => ({
  name,
  data: target,
  mode: 0o120777,
})
function candidate(): KernelManifest {
  const providerId = 'fingerprint-chromium-apostate'
  const release = fingerprintProviderRelease(providerId, 'darwin', 'arm64', version)!
  return {
    ...createFingerprintChromiumManifest('darwin', 'arm64'),
    providerId,
    id: fingerprintKernelId(release.version, providerId),
    version: release.version,
    source: fingerprintProvider(providerId)!.source,
    package: { ...release.package },
    dataDirCompatibility: [release.version],
  }
}

// Hand-built, inert ZIPs; no candidate bytes, external archivers, mounts or execution.
function zipBytes(entries: FixtureEntry[]): Buffer {
  const local: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const entry of entries) {
    const name = Buffer.from(entry.name)
    const data = Buffer.from(entry.data ?? '')
    const compressed = entry.deflated ? deflateRawSync(data) : data
    let crc = 0xffffffff
    for (const byte of data) {
      crc ^= byte
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
    crc = (crc ^ 0xffffffff) >>> 0
    const header = Buffer.alloc(30)
    header.writeUInt32LE(0x04034b50, 0)
    header.writeUInt16LE(20, 4)
    header.writeUInt16LE(0x800, 6)
    header.writeUInt16LE(entry.deflated ? 8 : 0, 8)
    header.writeUInt32LE(crc, 14)
    header.writeUInt32LE(compressed.length, 18)
    header.writeUInt32LE(entry.size ?? data.length, 22)
    header.writeUInt16LE(name.length, 26)
    const directory = Buffer.alloc(46)
    directory.writeUInt32LE(0x02014b50, 0)
    directory.writeUInt16LE(0x0314, 4)
    header.copy(directory, 6, 4, 30)
    const mode = entry.mode ?? (entry.name.endsWith('/') ? 0o40755 : 0o100644)
    directory.writeUInt32LE((mode << 16) >>> 0, 38)
    directory.writeUInt32LE(offset, 42)
    local.push(header, name, compressed)
    central.push(directory, name)
    offset += header.length + name.length + compressed.length
  }
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(
    central.reduce((sum, part) => sum + part.length, 0),
    12,
  )
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...local, ...central, end])
}
async function fixture(entries: FixtureEntry[] = packageEntries, wrapper = '') {
  const root = await mkdtemp(join(tmpdir(), 'cw-mac-zip-'))
  roots.push(root)
  const archive = join(root, 'package.download')
  const stage = join(root, 'stage')
  await mkdir(stage)
  await writeFile(
    archive,
    zipBytes(entries.map((entry) => ({ ...entry, name: wrapper + entry.name }))),
  )
  return { root, archive, stage, payload: join(stage, 'payload') }
}
async function assertNoLinks(directory: string): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    expect(entry.isSymbolicLink(), entry.name).toBe(false)
    if (entry.isDirectory()) await assertNoLinks(join(directory, entry.name))
  }
}
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(withKernelDmg).mockRejectedValue(new Error('DMG_FIXTURE'))
})
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('trusted Mac ZIP layout', () => {
  it.each(['', 'one-wrapper/'])(
    'retains the complete %s package root, not just the app',
    async (wrapper) => {
      const f = await fixture(packageEntries, wrapper)
      const manifest = candidate()
      expect(fingerprintArchiveFormat(manifest)).toBe('zip')
      expect(fingerprintProvider(manifest.providerId!)?.admission).toBe('audit-only')
      const root = await extractBrowserArchive(f.archive, f.stage, manifest, signal())
      expect(root).toBe(join(f.payload, wrapper.replace(/\/$/, '')))
      expect((await readdir(root)).sort()).toEqual([
        'Chromium.app',
        'LICENSE',
        'build',
        'resources',
      ])
      for (const entry of packageEntries)
        expect(await readFile(join(root, entry.name), 'utf8')).toBe(entry.data)
      expect(await lstat(join(root, 'Chromium.app')).then((stat) => stat.isDirectory())).toBe(true)
      expect(withKernelDmg).not.toHaveBeenCalled()
    },
  )

  it.skipIf(process.platform !== 'darwin').each(['', 'one-wrapper/'])(
    'materializes forward framework chains and safe outer resources only after validating %s',
    async (wrapper) => {
      const aliases = [
        link(`${framework}/Chromium Framework`, 'Versions/Current/Chromium Framework'),
        link(`${framework}/Resources`, 'Versions/Current/Resources'),
        link(`${framework}/Versions/Current`, version),
        link('resources/current', 'profiles'),
        link('build/license', '../LICENSE'),
      ]
      const f = await fixture(
        [
          ...aliases,
          ...packageEntries,
          {
            name: `${framework}/Versions/${version}/Chromium Framework`,
            data: 'framework fixture',
            mode: 0o100755,
          },
          {
            name: `${framework}/Versions/${version}/Resources/resources.pak`,
            data: 'credits fixture',
          },
          // Explicit directories after implicit parents are valid, but only once.
          { name: 'resources/' },
        ],
        wrapper,
      )
      const root = await extractBrowserArchive(f.archive, f.stage, candidate(), signal())
      for (const entry of aliases) expect(await readlink(join(root, entry.name))).toBe(entry.data)
      expect(await readFile(join(root, framework, 'Chromium Framework'), 'utf8')).toBe(
        'framework fixture',
      )
      expect(await readFile(join(root, framework, 'Resources/resources.pak'), 'utf8')).toBe(
        'credits fixture',
      )
      expect(await readFile(join(root, 'resources/current/catalogue.json'), 'utf8')).toBe(
        '{"fixture":true}',
      )
      expect(await readFile(join(root, 'build/license'), 'utf8')).toBe('complete license fixture')
    },
  )

  it.skipIf(process.platform === 'win32')(
    'keeps owner execution without set-id or group/other access',
    async () => {
      const f = await fixture([
        ...packageEntries,
        { name: 'resources/' },
        { name: 'privileged', mode: 0o107777, data: 'fixture' },
        { name: 'not-owner-executable', mode: 0o100011, data: 'fixture' },
      ])
      const root = await extractBrowserArchive(f.archive, f.stage, candidate(), signal())
      for (const [name, mode] of [
        [executable, 0o700],
        ['privileged', 0o700],
        ['not-owner-executable', 0o600],
        ['LICENSE', 0o600],
        ['resources', 0o700],
        ['resources/profiles', 0o700],
        ['', 0o700],
      ] as const)
        expect((await lstat(join(root, name))).mode & 0o7777).toBe(mode)
    },
  )

  const invalidLayouts: [string, FixtureEntry[]][] = [
    ['empty', []],
    ['no app', [{ name: 'LICENSE', data: 'fixture' }]],
    ['app file', [{ name: 'Chromium.app', data: 'not a directory' }]],
    ['app alias', [{ name: 'real-app/' }, link('Chromium.app', 'real-app')]],
    ['wrong case app', [{ name: 'chromium.app/Contents/MacOS/Chromium', data: 'fixture' }]],
    ['two wrappers', [{ name: 'one/Chromium.app/' }, { name: 'two/Chromium.app/' }]],
    ['nested wrappers', [{ name: 'one/two/Chromium.app/' }]],
    [
      'loose license beside wrapper',
      [{ name: 'one/Chromium.app/' }, { name: 'LICENSE', data: 'must not discard' }],
    ],
    [
      'loose resources beside wrapper',
      [
        { name: 'one/Chromium.app/' },
        { name: 'resources/profiles/data', data: 'must not discard' },
      ],
    ],
    ['root and wrapped apps', [{ name: 'Chromium.app/' }, { name: 'one/Chromium.app/' }]],
  ]
  it.each(invalidLayouts)('rejects ambiguous/missing layouts: %s', async (_name, entries) => {
    const f = await fixture(entries)
    await expect(extractBrowserArchive(f.archive, f.stage, candidate(), signal())).rejects.toThrow(
      'ARCHIVE_INVALID',
    )
    await assertNoLinks(f.payload)
  })
})

describe('ZIP dispatch preserves existing platform defaults', () => {
  it.each([
    'legacy',
    'custom ZIP URL',
    'unknown provider',
    'unpinned hash',
    'untrusted format field',
  ])('uses the DMG path for %s, never a filename or an untrusted package.format', async (kind) => {
    const f = await fixture()
    let manifest = candidate()
    if (kind === 'legacy') manifest = createFingerprintChromiumManifest('darwin', 'arm64')
    else if (kind === 'custom ZIP URL') manifest = { ...manifest, sourceType: 'custom' }
    else if (kind === 'unknown provider') manifest = { ...manifest, providerId: 'unknown' }
    else if (kind === 'unpinned hash')
      manifest = { ...manifest, package: { ...manifest.package, sha256: '0'.repeat(64) } }
    else {
      const spoofed = {
        ...manifest,
        package: { ...manifest.package, url: 'https://example.test/package.zip', format: 'zip' },
      }
      manifest = spoofed
    }
    await expect(extractBrowserArchive(f.archive, f.stage, manifest, signal())).rejects.toThrow(
      'DMG_FIXTURE',
    )
    expect(withKernelDmg).toHaveBeenCalledOnce()
    expect(await readdir(f.payload)).toEqual([])
  })
  it('preserves the DMG copy path using only a simulated mount', async () => {
    const f = await fixture()
    const mount = join(f.root, 'simulated-mount')
    await mkdir(join(mount, 'Chromium.app'), { recursive: true })
    await writeFile(join(mount, 'Chromium.app', 'sentinel'), 'mounted fixture')
    vi.mocked(withKernelDmg).mockImplementation(async (_archive, _stage, _signal, use) => {
      await use(mount)
    })
    const root = await extractBrowserArchive(
      f.archive,
      f.stage,
      createFingerprintChromiumManifest('darwin', 'arm64'),
      signal(),
    )
    expect(await readFile(join(root, 'Chromium.app', 'sentinel'), 'utf8')).toBe('mounted fixture')
  })
  it.each(['', 'portable/'])('preserves Windows %s ZIP extraction', async (wrapper) => {
    const f = await fixture(
      [
        { name: 'chrome.exe', data: 'inert Windows fixture', mode: 0o100755 },
        { name: 'LICENSE', data: 'notice' },
      ],
      wrapper,
    )
    const root = await extractBrowserArchive(
      f.archive,
      f.stage,
      createFingerprintChromiumManifest('win32', 'x64'),
      signal(),
    )
    expect(root).toBe(join(f.payload, wrapper.replace(/\/$/, '')))
    expect(await readFile(join(root, 'LICENSE'), 'utf8')).toBe('notice')
    if (process.platform !== 'win32')
      expect((await lstat(join(root, 'chrome.exe'))).mode & 0o777).toBe(0o600)
    expect(withKernelDmg).not.toHaveBeenCalled()
  })
  it.each(['extractZip', 'Windows dispatch'])(
    'still rejects symlinks by default via %s',
    async (entryPoint) => {
      const f = await fixture([
        { name: 'chrome.exe', data: 'inert fixture' },
        link('alias', 'chrome.exe'),
      ])
      if (entryPoint === 'extractZip') await mkdir(f.payload)
      const result =
        entryPoint === 'extractZip'
          ? extractZip(f.archive, f.payload, signal())
          : extractBrowserArchive(
              f.archive,
              f.stage,
              createFingerprintChromiumManifest('win32', 'x64'),
              signal(),
            )
      await expect(result).rejects.toThrow('ARCHIVE_UNSAFE')
      await assertNoLinks(f.payload)
    },
  )
})

describe('Mac ZIP rejects malicious entries on every host, before creating links', () => {
  it.each([
    '../escape',
    '/absolute',
    'resources\\escape',
    'C:/escape',
    'resources/./escape',
    'resources//escape',
    'resources/trailing.',
    'resources/trailing ',
    'resources/NUL',
    'resources/control\u0001',
    `resources/${'a'.repeat(256)}`,
    `${'segment/'.repeat(520)}file`,
  ])('rejects unsafe path %s', async (name) => {
    const f = await fixture([{ name, data: 'bad' }])
    await expect(extractBrowserArchive(f.archive, f.stage, candidate(), signal())).rejects.toThrow()
    expect(await readdir(f.payload)).toEqual([])
    expect((await readdir(f.root)).sort()).toEqual(['package.download', 'stage'])
  })

  const conflicts: [string, FixtureEntry[]][] = [
    ['duplicate file', [{ name: 'LICENSE', data: 'overwrite' }]],
    ['case duplicate', [{ name: 'license', data: 'overwrite' }]],
    ['implicit parent case conflict', [{ name: 'Resources/extra', data: 'fixture' }]],
    [
      'normalized Unicode parent conflict',
      [
        { name: 'résources/one', data: 'fixture' },
        { name: 're\u0301sources/two', data: 'fixture' },
      ],
    ],
    ['directory then file', [{ name: 'resources', data: 'fixture' }]],
    ['file then directory', [{ name: 'LICENSE/child', data: 'fixture' }]],
    ['duplicate directory', [{ name: 'empty/' }, { name: 'empty/' }]],
    ['duplicate link', [link('resources/alias', 'profiles'), link('resources/alias', 'profiles')]],
    [
      'link then child',
      [link('resources/alias', 'profiles'), { name: 'resources/alias/child', data: 'fixture' }],
    ],
    [
      'child then link',
      [{ name: 'resources/alias/child', data: 'fixture' }, link('resources/alias', 'profiles')],
    ],
    [
      'link then explicit parent',
      [link('resources/alias', 'profiles'), { name: 'resources/alias/' }],
    ],
    [
      'case link parent conflict',
      [link('resources/ALIAS', 'profiles'), { name: 'resources/alias/child', data: 'fixture' }],
    ],
    ['link directory marker', [link('resources/alias/', 'profiles')]],
    ['directory without marker', [{ name: 'empty', mode: 0o40755 }]],
    ['file with directory marker', [{ name: 'file/', mode: 0o100644 }]],
    ['nonempty directory', [{ name: 'empty/', data: 'hidden bytes' }]],
    ['FIFO', [{ name: 'fifo', mode: 0o10644 }]],
    ['device', [{ name: 'device', mode: 0o20644 }]],
    ['socket', [{ name: 'socket', mode: 0o140644 }]],
  ]
  it.each(conflicts)(
    'rejects %s without overwriting or materializing aliases',
    async (_name, entries) => {
      const f = await fixture([...packageEntries, ...entries])
      await expect(
        extractBrowserArchive(f.archive, f.stage, candidate(), signal()),
      ).rejects.toThrow('ARCHIVE_UNSAFE')
      expect(await readFile(join(f.payload, 'LICENSE'), 'utf8')).toBe('complete license fixture')
      await assertNoLinks(f.payload)
    },
  )

  const unsafeLinks: [string, FixtureEntry[]][] = [
    ['absolute', [link('resources/bad', '/outside')]],
    ['drive path', [link('resources/bad', 'C:/outside')]],
    ['backslash', [link('resources/bad', '..\\outside')]],
    ['control byte', [link('resources/bad', 'profiles\0')]],
    ['empty target', [link('resources/bad', '')]],
    ['invalid UTF-8', [link('resources/bad', Buffer.from([0xff]))]],
    ['empty component', [link('resources/bad', 'profiles//catalogue.json')]],
    ['oversized target', [link('resources/bad', 'x'.repeat(4097))]],
    ['payload escape', [link('resources/bad', '../../outside')]],
    ['outer build escape', [link('build/bad', '../../outside')]],
    [
      'app escape into existing payload license',
      [link('Chromium.app/Contents/bad', '../../LICENSE')],
    ],
    [
      'app escape and reentry',
      [link('Chromium.app/Contents/bad', '../../Chromium.app/Contents/MacOS/Chromium')],
    ],
    [
      'chain escape',
      [
        link('resources/profiles/redirect', '../../build'),
        link('resources/profiles/bad', 'redirect/../../LICENSE'),
      ],
    ],
    [
      'app chain escape',
      [
        link('Chromium.app/Contents/Frameworks/redirect', '../MacOS'),
        link('Chromium.app/Contents/Frameworks/bad', 'redirect/../../../LICENSE'),
      ],
    ],
    ['dangling link', [link('resources/bad', 'missing')]],
    ['dangling chain', [link('resources/bad', 'next'), link('resources/next', 'missing')]],
    ['self cycle', [link('resources/bad', 'bad')]],
    ['two-link cycle', [link('resources/bad', 'next'), link('resources/next', 'bad')]],
    ['ancestor directory cycle', [link('resources/bad', '.')]],
    ['file used as parent', [link('resources/bad', '../LICENSE/child')]],
    ['file then dot-dot', [link('resources/bad', '../LICENSE/../LICENSE')]],
    [
      'excessive chain',
      Array.from({ length: 42 }, (_, index) =>
        link(
          `resources/chain${index}`,
          index === 41 ? 'profiles/catalogue.json' : `chain${index + 1}`,
        ),
      ),
    ],
  ]
  it.each(unsafeLinks)('rejects %s across the entire payload', async (_name, entries) => {
    const f = await fixture([
      ...packageEntries,
      link('resources/safe-first', 'profiles'),
      ...entries,
    ])
    await expect(extractBrowserArchive(f.archive, f.stage, candidate(), signal())).rejects.toThrow(
      'ARCHIVE_UNSAFE',
    )
    await assertNoLinks(f.payload)
  })
  it('rejects an outer link leaving the selected wrapper even if it stays inside staging', async () => {
    const f = await fixture([...packageEntries, link('resources/bad', '../../outside')], 'wrapper/')
    await writeFile(join(f.stage, 'outside'), 'must not read')
    await expect(extractBrowserArchive(f.archive, f.stage, candidate(), signal())).rejects.toThrow(
      'ARCHIVE_UNSAFE',
    )
    await assertNoLinks(f.payload)
  })
  it('defers safe links until even the final ZIP entry has passed validation', async () => {
    const f = await fixture([
      link('resources/safe-first', 'profiles'),
      ...packageEntries,
      { name: 'resources/../bad', data: 'fixture' },
    ])
    await expect(extractBrowserArchive(f.archive, f.stage, candidate(), signal())).rejects.toThrow()
    await assertNoLinks(f.payload)
  })
  it('rejects a forged oversized entry before opening an output writer', async () => {
    const f = await fixture([{ name: executable, size: 800_000_001, deflated: true }])
    await expect(extractBrowserArchive(f.archive, f.stage, candidate(), signal())).rejects.toThrow(
      'ARCHIVE_UNSAFE',
    )
    expect(createWriteStream).not.toHaveBeenCalled()
  })
  it('rejects more than 50,000 declared entries without writing them', async () => {
    const f = await fixture(Array.from({ length: 50001 }, (_, index) => ({ name: `d${index}/` })))
    await expect(extractBrowserArchive(f.archive, f.stage, candidate(), signal())).rejects.toThrow(
      'ARCHIVE_UNSAFE',
    )
    expect(await readdir(f.payload)).toEqual([])
    expect(createWriteStream).not.toHaveBeenCalled()
  })
  it('rejects compressed size lies and truncated input, and permits immediate cleanup', async () => {
    const f = await fixture([{ name: executable, data: 'too many bytes', size: 1, deflated: true }])
    await expect(extractBrowserArchive(f.archive, f.stage, candidate(), signal())).rejects.toThrow()
    await rm(f.payload, { recursive: true })
    await writeFile(f.archive, zipBytes(packageEntries).subarray(0, 45))
    await expect(extractBrowserArchive(f.archive, f.stage, candidate(), signal())).rejects.toThrow()
    await rm(f.stage, { recursive: true })
  })
})

describe('Mac ZIP cancellation/writer ownership', () => {
  it('settles pre-cancellation without creating any entries', async () => {
    const f = await fixture()
    await expect(
      extractBrowserArchive(f.archive, f.stage, candidate(), AbortSignal.abort()),
    ).rejects.toThrow('CANCELLED')
    expect(await readdir(f.payload)).toEqual([])
    expect(createWriteStream).not.toHaveBeenCalled()
  })
  it.each(['cancel', 'writer failure'])(
    'waits for the active writer close after %s',
    async (kind) => {
      const f = await fixture()
      const controller = new AbortController()
      const fs = await vi.importActual<typeof import('node:fs')>('node:fs')
      let release: () => void = () => {
        throw new Error('writer did not start closing')
      }
      let notifyClosing: () => void = () => {}
      const closing = new Promise<void>((resolve) => {
        notifyClosing = resolve
      })
      vi.mocked(createWriteStream).mockImplementationOnce((path, options) => {
        const writer = fs.createWriteStream(path, options)
        const destroy = writer._destroy.bind(writer)
        writer._destroy = (error, callback) => {
          release = () => destroy(error, callback)
          notifyClosing()
        }
        writer.once('open', () => {
          if (kind === 'cancel') controller.abort()
          else writer.destroy(new Error('WRITE_FIXTURE'))
        })
        return writer
      })
      let settled = false
      const result = extractBrowserArchive(
        f.archive,
        f.stage,
        candidate(),
        controller.signal,
      ).finally(() => {
        settled = true
      })
      const rejected = expect(result).rejects.toThrow(
        kind === 'cancel' ? 'CANCELLED' : 'WRITE_FIXTURE',
      )
      await closing
      try {
        expect(settled).toBe(false)
      } finally {
        release()
      }
      await rejected
      await rm(f.stage, { recursive: true })
      expect((await readdir(f.root)).sort()).toEqual(['package.download'])
    },
  )
})
