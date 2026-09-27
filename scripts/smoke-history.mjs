// Real Main restart + sandboxed Renderer paging, using only a disposable application data root.
import { createRequire } from 'node:module'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import assert from 'node:assert/strict'
const require = createRequire(new URL('../apps/desktop/package.json', import.meta.url))
const { _electron } = require('playwright-core')
const root = await mkdtemp(join(tmpdir(), 'cw-history-smoke-'))
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
    () => typeof window.contextweave?.activity?.page === 'function',
    undefined,
    { timeout: 10000 },
  )
  return page
}
try {
  let page = await launch()
  const created = await page.evaluate(async () =>
    window.contextweave.environment.create({ workspaceId: (await window.contextweave.workspace.current()).data.workspaceId }, {
      name: 'History restart fixture',
      kernelId: 'standard-chromium',
      commonConfig: { language: 'system', timezone: 'system' },
    }),
  )
  assert(created.ok)
  const environmentId = created.data.id
  await desktop.close()
  desktop = undefined
  const file = join(root, 'contextweave', 'contextweave.sqlite')
  const db = new DatabaseSync(file)
  try {
    db.exec('PRAGMA foreign_keys=ON; BEGIN IMMEDIATE')
    const session = db.prepare(`INSERT INTO runtime_sessions
      (session_id,environment_id,pid,control_port,started_at,status,exit_reason,phase)
      VALUES (?,?,2147483647,9000,?,?,NULL,'fixture')`)
    const operation = db.prepare(`INSERT INTO operations
      (operation_id,environment_id,kind,status,phase,started_at,ended_at,error_code)
      VALUES (?,?,'start','succeeded',?,'2026-01-01T00:00:00.000Z',NULL,NULL)`)
    for (let i = 0; i < 241; i++) {
      const suffix = String(i).padStart(4, '0')
      session.run(
        `history-session-${suffix}`,
        environmentId,
        i < 121 ? '2026-01-01T00:00:00.000Z' : '2026-02-01T00:00:00.000Z',
        i < 121 ? 'running' : 'stopped',
      )
      operation.run(`history-operation-${suffix}`, environmentId, `fixture-${suffix}`)
    }
    db.prepare("UPDATE environments SET status='running' WHERE environment_id=?").run(environmentId)
    db.exec('COMMIT')
  } finally {
    db.close()
  }
  page = await launch()
  const recovered = await page.evaluate(
    async (id) => ({
      environment: await window.contextweave.environment.get({ workspaceId: (await window.contextweave.workspace.current()).data.workspaceId }, id),
      crashed: await window.contextweave.activity.page({ workspaceId: (await window.contextweave.workspace.current()).data.workspaceId }, { limit: 100, statuses: ['crashed'] }),
      bounded: await window.contextweave.activity.list({ workspaceId: (await window.contextweave.workspace.current()).data.workspaceId }),
    }),
    environmentId,
  )
  assert(recovered.environment.ok && recovered.environment.data.status === 'needs-recovery')
  assert(
    recovered.crashed.ok &&
      recovered.crashed.data.items.length === 100 &&
      recovered.crashed.data.nextCursor,
  )
  assert(recovered.bounded.ok && recovered.bounded.data.length === 100)
  const tail = await page.evaluate(
    async (cursor) => window.contextweave.activity.page({ workspaceId: (await window.contextweave.workspace.current()).data.workspaceId }, { limit: 100, statuses: ['crashed'], cursor }),
    recovered.crashed.data.nextCursor,
  )
  assert(tail.ok && tail.data.items.length === 21 && tail.data.nextCursor === null)
  assert(
    [...recovered.crashed.data.items, ...tail.data.items].every(
      (row) => row.exitReason === 'CLIENT_INTERRUPTED',
    ),
  )
  assert(
    (await page.evaluate(async (id) => window.contextweave.environment.recover({ workspaceId: (await window.contextweave.workspace.current()).data.workspaceId }, id), environmentId)).ok,
  )

  await page.getByRole('link', { name: '日志查看', exact: true }).click()
  await page.getByRole('tab', { name: '操作记录', exact: true }).click()
  const operations = page.locator('section[aria-label="操作记录"]')
  await operations.getByRole('status').filter({ hasText: '本页 20 条' }).waitFor()
  const firstRow = await operations.locator('tbody tr').first().innerText()
  await operations.getByRole('button', { name: '下一页', exact: true }).click()
  await page.waitForFunction((first) => {
    const region = document.querySelector('[aria-label="操作记录"]')
    const row = region?.querySelector('tbody tr')
    return row && row.textContent && row.innerText !== first && row.querySelector('td')
  }, firstRow)
  await operations.getByRole('status').filter({ hasText: '本页 20 条' }).waitFor()
  assert(await operations.getByRole('button', { name: '上一页', exact: true }).isEnabled())
  await operations.getByRole('textbox').fill('fixture-0000')
  await operations.getByRole('status').filter({ hasText: '本页 1 条' }).waitFor()
  assert((await operations.locator('tbody').innerText()).includes('fixture-0000'))
  assert(await operations.getByRole('button', { name: '下一页', exact: true }).isDisabled())
  await operations.getByRole('textbox').fill('not-present-in-any-page')
  await operations.getByRole('status').filter({ hasText: '本页 0 条' }).waitFor()
  await operations.getByRole('textbox').fill('')
  await operations.getByRole('status').filter({ hasText: '本页 20 条' }).waitFor()
  await operations.getByRole('button', { name: '列选项：阶段', exact: true }).click()
  await page.getByRole('menuitemradio', { name: '升序', exact: true }).click()
  await operations.getByRole('status').filter({ hasText: '本页 20 条' }).waitFor()
  // Default application operations have an earlier lexical phase; verify the server contract separately.
  const sorted = await page.evaluate(async () =>
    window.contextweave.operation.page({ workspaceId: (await window.contextweave.workspace.current()).data.workspaceId }, {
      sortBy: 'phase',
      direction: 'asc',
      search: 'fixture-',
      limit: 2,
    }),
  )
  assert(sorted.ok)
  assert.deepEqual(
    sorted.data.items.map((row) => row.phase),
    ['fixture-0000', 'fixture-0001'],
  )

  await page.getByRole('tab', { name: '运行会话', exact: true }).click()
  const sessions = page.locator('section[aria-label="运行记录"]')
  await sessions.getByRole('textbox').fill('history-session-0000')
  await sessions.getByRole('status').filter({ hasText: '本页 1 条' }).waitFor()
  assert((await sessions.locator('tbody').innerText()).includes('history-session-0000'))
  await desktop.close()
  desktop = undefined
  const check = new DatabaseSync(file)
  try {
    assert.equal(check.prepare('PRAGMA user_version').get().user_version, 13)
    assert.equal(check.prepare('SELECT count(*) AS n FROM runtime_sessions').get().n, 241)
    assert.equal(
      check.prepare("SELECT count(*) AS n FROM runtime_sessions WHERE status='crashed'").get().n,
      121,
    )
    assert.equal(
      check
        .prepare(
          "SELECT count(*) AS n FROM operations WHERE operation_id LIKE 'history-operation-%'",
        )
        .get().n,
      241,
    )
    assert.deepEqual(check.prepare('PRAGMA foreign_key_check').all(), [])
  } finally {
    check.close()
  }
  console.log(
    JSON.stringify({
      historyPaging: 'passed-real-renderer-global-search-sort-next-empty',
      historyRestartRecovery: 'passed-all-121-old-active-sessions',
      historyRetention: 'all-fixture-rows-preserved',
      platform: process.platform,
      arch: process.arch,
    }),
  )
} finally {
  if (desktop) await desktop.close()
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}

await import('./smoke-history-cleanup.mjs')
