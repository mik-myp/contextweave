// Real screenshot registration and restart through the public sandboxed bridge. No path IPC.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
const require = createRequire(new URL('../apps/desktop/package.json', import.meta.url))

export async function assertRegisteredScreenshot(call, outcome, bytes, expectedCount) {
  assert.match(outcome.data.artifactId, /^[a-f0-9-]{36}$/)
  const page = await call(() => window.contextweave.storage.pageArtifacts())
  assert(page.ok, 'ARTIFACT_PAGE_FAILED')
  const item = page.data.items.find((item) => item.artifactId === outcome.data.artifactId)
  assert(item, 'COMPLETED_SCREENSHOT_NOT_REGISTERED')
  assert.equal(item.environmentId, outcome.data.environmentId)
  assert.equal(item.taskId, outcome.data.taskId)
  assert.equal(item.bytes, bytes.length)
  assert.equal(item.sha256, createHash('sha256').update(bytes).digest('hex'))
  assert.equal(page.data.totals.count, expectedCount)
  assert.equal(Object.hasOwn(item, 'ownership'), false)
  assert.equal(Object.hasOwn(item, 'allocationName'), false)
  assert.equal(Object.hasOwn(item, 'screenshotPath'), false)
  return item
}

export async function verifyArtifactRestart(entry, directory, expected) {
  const { _electron } = require('playwright-core')
  const legacy = join(directory, 'contextweave', 'worker-results', 'run-legacy')
  await mkdir(legacy, { recursive: true })
  await writeFile(join(legacy, 'screenshot.png'), 'unknown output: must remain unowned')
  const app = await _electron.launch({ executablePath: require('electron'), args: [entry],
    env: { ...process.env, CONTEXTWEAVE_USER_DATA: directory }, timeout: 20000 })
  try {
    const page = await app.firstWindow()
    await page.waitForFunction(() => typeof window.contextweave?.storage?.pageArtifacts === 'function', undefined, { timeout: 10000 })
    const actual = await page.evaluate(() => window.contextweave.storage.pageArtifacts())
    assert(actual.ok)
    assert.deepEqual(actual.data.items.map((i) => i.artifactId).sort(), expected.map((i) => i.artifactId).sort())
    assert.deepEqual(actual.data.totals, { count: expected.length, bytes: expected.reduce((sum, i) => sum + i.bytes, 0) })
    for (const item of expected) assert.deepEqual(actual.data.items.find((i) => i.artifactId === item.artifactId), item)
    if (expected.length > 1) {
      const first = await page.evaluate(() => window.contextweave.storage.pageArtifacts({ limit: 1 }))
      assert(first.ok && first.data.nextCursor)
      const second = await page.evaluate((cursor) => window.contextweave.storage.pageArtifacts({ limit: 1, cursor }), first.data.nextCursor)
      assert(second.ok && second.data.previousCursor)
      assert.notEqual(second.data.items[0].artifactId, first.data.items[0].artifactId)
      const previous = await page.evaluate((cursor) => window.contextweave.storage.pageArtifacts({ limit: 1, cursor }), second.data.previousCursor)
      assert(previous.ok)
      assert.deepEqual(previous.data.items, first.data.items)
    }
    await page.getByRole('link', { name: '系统设置', exact: true }).click()
    await page.getByRole('link', { name: '本地存储', exact: true }).click()
    const section = page.getByRole('region', { name: '已登记截图', exact: true })
    await section.getByRole('button', { name: '刷新', exact: true }).waitFor()
    for (const item of expected) await section.getByText(item.sha256, { exact: true }).first().waitFor()
    await section.getByText(/不是全盘用量/).waitFor()
    assert.equal(await readFile(join(legacy, 'screenshot.png'), 'utf8'), 'unknown output: must remain unowned')
    console.log(JSON.stringify({ artifactInventory: 'registered-sha256-bytes-real-restart-pagination-read-only-ui', artifacts: expected.length, legacyOutput: 'retained-unowned' }))
  } finally { await app.close() }
}
