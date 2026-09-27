// Real migration and identity checks use an isolated published-v8 fixture, never user data.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { DatabaseSync } from 'node:sqlite'
import { access, mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
const require = createRequire(new URL('../apps/desktop/package.json', import.meta.url))

export async function assertWorkspaceIdentity(call) {
  const result = await call(() => window.contextweave.workspace.current())
  assert(result.ok, 'WORKSPACE_IDENTITY_UNAVAILABLE')
  const identity = result.data
  assert.deepEqual(Object.keys(identity).sort(), ['createdAt', 'kind', 'storageMode', 'workspaceId'])
  assert.match(identity.workspaceId, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/)
  assert.equal(identity.kind, 'personal')
  assert.equal(identity.storageMode, 'local')
  assert.equal(new Date(identity.createdAt).toISOString(), identity.createdAt)
  return identity
}

export async function verifyWorkspaceUpgrade(entry) {
  await access(entry)
  const directory = await mkdtemp(join(tmpdir(), 'cw-workspace-upgrade-'))
  const dataRoot = join(directory, 'contextweave'), profile = join(dataRoot, 'environments', 'old-environment')
  await mkdir(profile, { recursive: true })
  const marker = join(profile, 'retained-profile')
  await writeFile(marker, 'existing browser directory: do not relocate')
  const file = join(dataRoot, 'contextweave.sqlite')
  const sqlite = new DatabaseSync(file)
  try {
    sqlite.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; BEGIN IMMEDIATE;')
    sqlite.exec(await readFile(new URL('../packages/storage/test-fixtures/schema-v8.sql', import.meta.url), 'utf8'))
    const config = JSON.stringify({ environmentId: 'old-environment', name: 'Existing workspace environment', kernelId: 'standard-chromium', kernelVersion: 'local', commonConfig: {} })
    const at = '2026-09-27T00:00:00.000Z'
    sqlite.prepare(`INSERT INTO environments(environment_id,name,status,kernel_id,kernel_version,proxy_id,config_json,data_dir,platform,arch,created_at,updated_at,revision,lifecycle,trashed_at) VALUES(?,?,'stopped','standard-chromium','local',NULL,?,?,?,?,?,?,1,'active',NULL)`).run('old-environment', 'Existing workspace environment', config, profile, process.platform, process.arch, at, at)
    sqlite.prepare('INSERT INTO environment_revisions VALUES(?,1,?,?)').run('old-environment', config, at)
    sqlite.exec('UPDATE screenshot_budget SET limit_mib=64, revision=2; COMMIT;')
  } finally { sqlite.close() }
  const { _electron } = require('playwright-core')
  let identity
  try {
    for (let run = 0; run < 2; run++) {
      const app = await _electron.launch({ executablePath: require('electron'), args: [entry], env: { ...process.env, CONTEXTWEAVE_USER_DATA: directory }, timeout: 20000 })
      try {
        const page = await app.firstWindow()
        await page.waitForFunction(() => typeof window.contextweave?.workspace?.current === 'function', undefined, { timeout: 10000 })
        const current = await assertWorkspaceIdentity((...args) => page.evaluate(...args))
        if (identity) assert.deepEqual(current, identity, 'WORKSPACE_CHANGED_ON_RESTART')
        else identity = current
        const envs = await page.evaluate(() => window.contextweave.environment.list())
        assert(envs.ok && envs.data.length === 1 && envs.data[0].id === 'old-environment', 'WORKSPACE_UPGRADE_LOST_ENVIRONMENT')
        const budget = await page.evaluate(() => window.contextweave.storage.getArtifactBudget())
        assert(budget.ok && budget.data.limitMiB === 64 && budget.data.revision === 2, 'WORKSPACE_UPGRADE_CHANGED_BUDGET')
        await page.getByRole('button', { name: '工作空间详情', exact: true }).click()
        await page.locator('[data-workspace-id]').waitFor()
        assert.equal(await page.locator('[data-workspace-id]').textContent(), identity.workspaceId)
        await page.keyboard.press('Escape')
      } finally { await app.close() }
    }
    assert.equal(await readFile(marker, 'utf8'), 'existing browser directory: do not relocate')
    const backups = (await readdir(dataRoot)).filter(name => name.includes('.before-v9-'))
    assert.equal(backups.length, 1, 'WORKSPACE_MIGRATION_REPEATED')
    const before = new DatabaseSync(join(dataRoot, backups[0]), { readOnly: true })
    const after = new DatabaseSync(file, { readOnly: true })
    try {
      assert.equal(before.prepare('PRAGMA user_version').get().user_version, 8)
      assert.equal(after.prepare('PRAGMA user_version').get().user_version, 9)
      assert.equal(after.prepare('SELECT workspace_id FROM local_workspace').get().workspace_id, identity.workspaceId)
      assert.equal(after.prepare('SELECT data_dir FROM environments').get().data_dir, profile)
      assert.deepEqual(after.prepare('SELECT * FROM environment_revisions').all(), before.prepare('SELECT * FROM environment_revisions').all())
    } finally { before.close(); after.close() }
    console.log(JSON.stringify({ workspace: 'published-v8-upgrade-restart-persisted-identity-real-switcher', profile: 'retained-in-place', migration: 'single-consistent-v9-backup' }))
  } finally { await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) }
}
