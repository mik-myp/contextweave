// Explicit cleanup through the real sandboxed Renderer, with isolated old history and restart.
import { createRequire } from 'node:module'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import assert from 'node:assert/strict'
const require = createRequire(new URL('../apps/desktop/package.json', import.meta.url))
const { _electron } = require('playwright-core')
const root = await mkdtemp(join(tmpdir(), 'cw-history-cleanup-smoke-'))
const file = join(root, 'contextweave', 'contextweave.sqlite')
let desktop
async function launch() {
  desktop = await _electron.launch({
    executablePath: require('electron'),
    args: [fileURLToPath(new URL('../apps/desktop/', import.meta.url)).replace(/[\\/]$/, '')],
    env: { ...process.env, CONTEXTWEAVE_USER_DATA: root },
    timeout: 20000,
  })
  const page = await desktop.firstWindow()
  await page.waitForFunction(
    () => typeof window.contextweave?.storage?.previewHistoryCleanup === 'function',
    undefined,
    { timeout: 10000 },
  )
  return page
}
async function settings(page) {
  await page.getByRole('link', { name: '系统设置', exact: true }).click()
  await page.getByRole('link', { name: '本地存储', exact: true }).click()
  const section = page.getByRole('region', { name: '历史记录清理', exact: true })
  await section.getByRole('button', { name: '预览清理范围', exact: true }).waitFor()
  return section
}
try {
  let page = await launch()
  const environments = await page.evaluate(async () => {
    const create = async (name) =>
      window.contextweave.environment.create({ workspaceId: (await window.contextweave.workspace.current()).data.workspaceId }, {
        name,
        kernelId: 'standard-chromium',
        commonConfig: { language: 'system', timezone: 'system' },
      })
    return [await create('Cleanup fixture'), await create('Protected fixture')]
  })
  assert(environments.every((item) => item.ok))
  const [environmentId, protectedId] = environments.map((item) => item.data.id)
  await desktop.close()
  desktop = undefined
  const seed = new DatabaseSync(file)
  try {
    seed.exec('PRAGMA foreign_keys=ON; BEGIN IMMEDIATE')
    const session = seed.prepare(`INSERT INTO runtime_sessions
      (session_id,environment_id,pid,control_port,started_at,ended_at,status,exit_reason,phase,executable_version)
      VALUES (?,?,2147483647,9000,'2020-01-01T00:00:00.000Z','2020-01-02T00:00:00.000Z','stopped',NULL,'ended',?)`)
    const operation = seed.prepare(`INSERT INTO operations
      (operation_id,environment_id,kind,status,phase,started_at,ended_at,error_code)
      VALUES (?,?,'start','succeeded','completed','2020-01-01T00:00:00.000Z','2020-01-02T00:00:00.000Z',NULL)`)
    for (let i = 0; i < 505; i++) {
      const suffix = String(i).padStart(4, '0')
      session.run(`cleanup-session-${suffix}`, environmentId, i === 504 ? '148.0.0.1' : null)
      operation.run(`cleanup-operation-${suffix}`, environmentId)
    }
    session.run('protected-session', protectedId, null)
    operation.run('protected-operation', protectedId)
    seed
      .prepare("UPDATE environments SET status='needs-recovery' WHERE environment_id=?")
      .run(protectedId)
    operation.run('ambiguous-operation', environmentId)
    seed.exec(
      "UPDATE operations SET status='failed',phase='interrupted',error_code='CLIENT_INTERRUPTED' WHERE operation_id='ambiguous-operation'; COMMIT",
    )
  } finally {
    seed.close()
  }
  page = await launch()
  await page.getByRole('link', { name: '日志查看', exact: true }).click()
  await page.getByRole('tab', { name: '操作记录', exact: true }).click()
  let operations = page.locator('section[aria-label="操作记录"]')
  await operations.getByRole('textbox').fill('Cleanup fixture')
  await operations.getByRole('status').filter({ hasText: '本页 20 条' }).waitFor()
  await operations.getByRole('button', { name: '下一页', exact: true }).click()
  await operations
    .getByRole('button', { name: '上一页', exact: true })
    .waitFor({ state: 'visible' })
  await page.waitForFunction(() =>
    [...document.querySelectorAll('[aria-label="操作记录"] button')].some(
      (button) => button.textContent === '上一页' && !button.disabled,
    ),
  )
  const before = await page.evaluate(async () => {
    const first = await window.contextweave.operation.page({ workspaceId: (await window.contextweave.workspace.current()).data.workspaceId }, { search: 'Cleanup fixture', limit: 20 })
    window.__cleanupEvents = []
    window.contextweave.events.onDataChanged({workspaceId:(await window.contextweave.workspace.current()).data.workspaceId}, (domains) => window.__cleanupEvents.push(domains))
    return first
  })
  assert(before.ok && before.data.nextCursor)
  let section = await settings(page)
  assert.equal(
    await section.getByRole('button', { name: '90 天', exact: true }).getAttribute('aria-pressed'),
    'true',
  )
  await section.getByRole('button', { name: '预览清理范围', exact: true }).click()
  await section
    .getByText('本批最多清理 500 条会话记录和 500 条操作记录。', { exact: true })
    .waitFor()
  assert((await section.innerText()).includes('本页数量不是全库总数'))
  await section.getByRole('button', { name: '确认本批清理…', exact: true }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: '取消', exact: true }).click()
  assert.deepEqual(
    await page.evaluate(async () => window.contextweave.storage.getHistoryCleanupReceipt({ workspaceId: (await window.contextweave.workspace.current()).data.workspaceId })),
    { ok: true, data: null },
  )
  await section.getByRole('button', { name: '确认本批清理…', exact: true }).click()
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: '永久删除本批', exact: true })
    .click()
  await section
    .getByText('本批清理已提交，详情见最近回执。状态变化或已不存在的候选已跳过。', { exact: true })
    .waitFor()
  const receipt = await page.evaluate(async () => window.contextweave.storage.getHistoryCleanupReceipt({ workspaceId: (await window.contextweave.workspace.current()).data.workspaceId }))
  assert(receipt.ok && receipt.data)
  for (const kind of ['sessions', 'operations'])
    assert.deepEqual(receipt.data[kind], { selected: 500, deleted: 500, skipped: 0 })
  const replay = await page.evaluate(
    async (previewId) => window.contextweave.storage.confirmHistoryCleanup({ workspaceId: (await window.contextweave.workspace.current()).data.workspaceId }, { previewId }),
    receipt.data.previewId,
  )
  assert(replay.ok && replay.data.replayed)
  assert(
    await page.evaluate(() =>
      window.__cleanupEvents.some((domains) =>
        ['activity', 'operations', 'storage'].every((domain) => domains.includes(domain)),
      ),
    ),
  )
  const stale = await page.evaluate(
    async (cursor) =>
      window.contextweave.operation.page({ workspaceId: (await window.contextweave.workspace.current()).data.workspaceId }, { search: 'Cleanup fixture', limit: 20, cursor }),
    before.data.nextCursor,
  )
  assert(!stale.ok && stale.code === 'HISTORY_CURSOR_STALE')

  await page.getByRole('link', { name: '日志查看', exact: true }).click()
  await page.getByRole('tab', { name: '操作记录', exact: true }).click()
  operations = page.locator('section[aria-label="操作记录"]')
  await operations.getByText('分页边界记录已移除，请返回首段重新读取。', { exact: true }).waitFor()
  assert.equal(await operations.locator('table').count(), 0)
  await operations.getByRole('button', { name: '返回首段', exact: true }).click()
  await operations.getByRole('status').filter({ hasText: '本页 7 条' }).waitFor()
  await desktop.close()
  desktop = undefined
  page = await launch()
  section = await settings(page)
  await section.getByText(receipt.data.previewId, { exact: true }).waitFor()
  const afterRestart = await page.evaluate(
    async (previewId) => window.contextweave.storage.confirmHistoryCleanup({ workspaceId: (await window.contextweave.workspace.current()).data.workspaceId }, { previewId }),
    receipt.data.previewId,
  )
  assert(afterRestart.ok && afterRestart.data.replayed)
  await section.getByRole('button', { name: '预览清理范围', exact: true }).click()
  await section.getByText('本批最多清理 4 条会话记录和 5 条操作记录。', { exact: true }).waitFor()
  await section.getByRole('button', { name: '放弃本批预览', exact: true }).click()
  await desktop.close()
  desktop = undefined
  const check = new DatabaseSync(file)
  try {
    assert.equal(check.prepare('PRAGMA user_version').get().user_version, 12)
    assert.equal(check.prepare('SELECT count(*) AS n FROM runtime_sessions').get().n, 6)
    assert.equal(
      check
        .prepare(
          "SELECT count(*) AS n FROM operations WHERE operation_id LIKE 'cleanup-operation-%'",
        )
        .get().n,
      5,
    )
    assert(
      check.prepare("SELECT 1 FROM runtime_sessions WHERE session_id='protected-session'").get(),
    )
    assert(check.prepare("SELECT 1 FROM operations WHERE operation_id='protected-operation'").get())
    assert(check.prepare("SELECT 1 FROM operations WHERE operation_id='ambiguous-operation'").get())
    assert.equal(
      check
        .prepare(
          'SELECT executable_version FROM runtime_sessions WHERE environment_id=? AND executable_version IS NOT NULL ORDER BY started_at DESC, session_id DESC LIMIT 1',
        )
        .get(environmentId).executable_version,
      '148.0.0.1',
    )
    assert.equal(check.prepare('SELECT count(*) AS n FROM environments').get().n, 2)
    assert.equal(check.prepare('SELECT count(*) AS n FROM environment_revisions').get().n, 2)
    assert.deepEqual(check.prepare('PRAGMA foreign_key_check').all(), [])
  } finally {
    check.close()
  }
  console.log(
    JSON.stringify({
      historyCleanup: 'passed-preview-cancel-confirm-bounded-protected',
      historyCleanupReplay: 'passed-after-main-restart-no-new-batch',
      historyCleanupCursor: 'passed-invalidation-stale-first-page',
      platform: process.platform,
      arch: process.arch,
    }),
  )
} finally {
  if (desktop) await desktop.close()
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
