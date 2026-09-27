import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, existsSync, writeFileSync, renameSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import type { ArtifactRecord } from '@contextweave/contracts'
import type { WorkerTask } from '@contextweave/worker-protocol'
import { createWorkerOutput } from './worker-output'
import { createArtifactService } from './artifacts'
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3])
const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
const task: WorkerTask = {
  protocolVersion: 1,
  taskId: 'repeatable',
  environmentId: 'env',
  kind: 'browser-smoke',
  input: { url: 'http://127.0.0.1/', timeoutMs: 1000 },
}
async function setup() {
  const root = mkdtempSync(join(tmpdir(), 'cw-artifact-service-'))
  roots.push(root)
  const registerArtifact = vi.fn<(record: ArtifactRecord) => void>()
  const pageArtifacts = vi.fn(() => ({
    items: [],
    totals: { count: 0, bytes: 0 },
    previousCursor: null,
    nextCursor: null,
  }))
  const changed = vi.fn()
  const service = createArtifactService({ registerArtifact, pageArtifacts }, changed)
  const output = createWorkerOutput(join(root, 'results'))
  await output.append(png)
  await output.close()
  return { root, registerArtifact, pageArtifacts, changed, service, output }
}
it('registers only Main-owned IDs, bounded names, full content digest and original identities', async () => {
  const f = await setup()
  const expected = f.output.inspect()
  expect(f.service.register(task, f.output)).toEqual({
    ok: true,
    artifactId: f.output.artifactId,
    screenshotPath: f.output.screenshotPath,
  })
  expect(f.registerArtifact).toHaveBeenCalledOnce()
  const record = f.registerArtifact.mock.calls[0]![0]
  expect(record).toMatchObject({
    ...expected,
    taskId: task.taskId,
    environmentId: task.environmentId,
    sha256: createHash('sha256').update(png).digest('hex'),
  })
  expect(record.artifactId).not.toBe(record.taskId)
  expect(JSON.stringify(record)).not.toContain(f.root)
  expect(f.changed).toHaveBeenCalledWith(['storage'])
})
it('retains complete files when metadata commit is unconfirmed and sanitizes raw storage failures', async () => {
  const f = await setup()
  f.registerArtifact.mockImplementation(() => {
    throw new Error('/private/path credential disk full')
  })
  expect(f.service.register(task, f.output)).toEqual({
    ok: false,
    code: 'WORKER_OUTPUT_REGISTRATION_UNCONFIRMED',
    preserve: true,
  })
  expect(existsSync(f.output.screenshotPath)).toBe(true)
  expect(f.changed).not.toHaveBeenCalled()
})
it('does not turn a dropped notification into a failed committed task', async () => {
  const f = await setup()
  f.changed.mockImplementation(() => {
    throw new Error('renderer closed')
  })
  expect(f.service.register(task, f.output).ok).toBe(true)
  expect(existsSync(f.output.screenshotPath)).toBe(true)
})
it.each(['same-size-content', 'replacement-file', 'replacement-root', 'unexpected-entry'])(
  'rejects %s before attempting metadata registration',
  async (mode) => {
    const f = await setup()
    if (mode === 'same-size-content') {
      const changed = new Uint8Array(png)
      changed[10] = 99
      writeFileSync(f.output.screenshotPath, changed)
    }
    if (mode === 'replacement-file') {
      renameSync(f.output.screenshotPath, join(f.root, 'original'))
      writeFileSync(f.output.screenshotPath, png)
    }
    if (mode === 'replacement-root') {
      renameSync(join(f.root, 'results'), join(f.root, 'original'))
      mkdirSync(f.output.directory, { recursive: true })
      writeFileSync(f.output.screenshotPath, png)
    }
    if (mode === 'unexpected-entry') writeFileSync(join(f.output.directory, 'unknown'), 'keep')
    expect(f.service.register(task, f.output)).toEqual({
      ok: false,
      code: 'WORKER_OUTPUT_INVALID',
      preserve: false,
    })
    expect(f.registerArtifact).not.toHaveBeenCalled()
  },
)
it('does not adopt legacy files or accept page paths, and delegates only validated bounded queries', async () => {
  const f = await setup()
  writeFileSync(join(f.root, 'legacy.png'), png)
  expect(() => f.service.page({ path: f.root })).toThrow()
  expect(() => f.service.page({ limit: 51 })).toThrow()
  f.service.page({})
  expect(f.pageArtifacts).toHaveBeenCalledExactlyOnceWith({ limit: 20, cursor: null })
  expect(f.registerArtifact).not.toHaveBeenCalled()
})
