import { desktopStage } from './smoke-desktop-stages.mjs'
// Isolated published v4–v13 fixtures plus the unreleased v14 schema; never user data.
const currentSchemaVersion = 14
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
  for (const previousVersion of [4, 8, 9, 10, 11, 12, 13, 14]) await verifyUpgradeFrom(entry, previousVersion)
}

async function verifyUpgradeFrom(entry, previousVersion) {
  await access(entry)
  const directory = await mkdtemp(join(tmpdir(), 'cw-workspace-upgrade-'))
  const dataRoot = join(directory, 'contextweave'), profile = join(dataRoot, 'environments', 'old-environment')
  await mkdir(profile, { recursive: true })
  const marker = join(profile, 'retained-profile')
  await writeFile(marker, 'existing browser directory: do not relocate')
  const file = join(dataRoot, 'contextweave.sqlite')
  const sqlite = new DatabaseSync(file)
  let originalIdentity, originalRevisions
  try {
    sqlite.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; BEGIN IMMEDIATE;')
    sqlite.exec(await readFile(new URL(`../packages/storage/test-fixtures/schema-v${Math.min(previousVersion, 13)}.sql`, import.meta.url), 'utf8'))
    if (previousVersion === 14) sqlite.exec(await readFile(new URL('../packages/storage/test-fixtures/tags-v14.sql', import.meta.url), 'utf8'))
    const config = JSON.stringify({ environmentId: 'old-environment', name: 'Existing workspace environment', kernelId: 'standard-chromium', kernelVersion: 'local', commonConfig: {} })
    const at = '2026-09-27T00:00:00.000Z'
    sqlite.prepare(`INSERT INTO environments(environment_id,name,status,kernel_id,kernel_version,proxy_id,config_json,data_dir,platform,arch,created_at,updated_at,revision,lifecycle,trashed_at) VALUES(?,?,'stopped','standard-chromium','local',NULL,?,?,?,?,?,?,1,'active',NULL)`).run('old-environment', 'Existing workspace environment', config, profile, process.platform, process.arch, at, at)
    sqlite.prepare('INSERT INTO environment_revisions(environment_id,revision,config_json,created_at) VALUES(?,1,?,?)').run('old-environment', config, at)
    if (previousVersion >= 8) sqlite.exec('UPDATE screenshot_budget SET limit_mib=64, revision=2')
    sqlite.exec('COMMIT')
    originalRevisions = sqlite.prepare('SELECT environment_id,revision,config_json,created_at FROM environment_revisions').all()
    if (previousVersion >= 9) originalIdentity = sqlite.prepare('SELECT workspace_id FROM local_workspace').get().workspace_id
  } finally { sqlite.close() }
  const { _electron } = require('playwright-core')
  let identity, preserveFixture = false
  try {
    for (let run = 0; run < 2; run++) {
      const app = await desktopStage(`workspace-v${previousVersion}-launch-${run}`, () => _electron.launch({ executablePath: require('electron'), args: [entry], env: { ...process.env, CONTEXTWEAVE_USER_DATA: directory }, timeout: 20000 }), { timeoutMs: 20000 })
      try {
        const page = await desktopStage(`workspace-v${previousVersion}-first-window-${run}`, () => app.firstWindow(), { timeoutMs: 10000, app })
        await page.waitForFunction(() => typeof window.contextweave?.workspace?.current === 'function', undefined, { timeout: 10000 })
        const current = await assertWorkspaceIdentity((...args) => page.evaluate(...args))
        if (identity) assert.deepEqual(current, identity, 'WORKSPACE_CHANGED_ON_RESTART')
        else identity = current
        if (originalIdentity) assert.equal(current.workspaceId, originalIdentity, 'EXISTING_V9_IDENTITY_CHANGED')
        const envs = await page.evaluate(async () => window.contextweave.environment.list({ workspaceId: (await window.contextweave.workspace.current()).data.workspaceId }))
        assert(envs.ok && envs.data.length === 1 && envs.data[0].id === 'old-environment', 'WORKSPACE_UPGRADE_LOST_ENVIRONMENT')
        const budget = await page.evaluate(async () => window.contextweave.storage.getArtifactBudget({ workspaceId: (await window.contextweave.workspace.current()).data.workspaceId }))
        assert(budget.ok && budget.data.limitMiB === (previousVersion >= 8 ? 64 : 1024) && budget.data.revision === (previousVersion >= 8 ? 2 : 1), 'WORKSPACE_UPGRADE_CHANGED_BUDGET')
        await page.getByRole('button', { name: '工作空间详情', exact: true }).click()
        await page.locator('[data-workspace-id]').waitFor()
        assert.equal(await page.locator('[data-workspace-id]').textContent(), identity.workspaceId)
        await page.keyboard.press('Escape')
        const organization = await page.evaluate(async (run) => {
          const context = {workspaceId:(await window.contextweave.workspace.current()).data.workspaceId}
          if (run === 0) {
            const group = await window.contextweave.organization.createGroup(context, {name:'Retained organization'})
            if (!group.ok) return group
            const saved = await window.contextweave.organization.saveEnvironment(context, {environmentId:'old-environment',groupId:group.data.id,tags:['Review','中文'],note:'Retained note',expectedRevision:0})
            if (!saved.ok) return saved
            const view = await window.contextweave.organization.createView(context, {name:'Retained view',view:{version:1,search:'Existing',filters:{statuses:[],kernelIds:[],proxyIds:[],groupIds:[group.data.id],tags:['review']},sorting:[{id:'name',desc:false}],hiddenColumns:['note']}})
            if (!view.ok) return view
          }
          return window.contextweave.organization.list(context)
        },run)
        assert(organization.ok, 'ORGANIZATION_REAL_IPC_FAILED')
        assert.equal(organization.data.groups[0].name,'Retained organization')
        assert.equal(organization.data.environments[0].note,'Retained note')
        assert.deepEqual(organization.data.environments[0].tags,['Review','中文'])
        assert.deepEqual(organization.data.tags.map(tag => tag.name).sort(), ['Review','中文'].sort(), 'TAG_CATALOG_LOST_ON_RESTART')
        assert.equal(organization.data.views[0].name,'Retained view')
        const batch = await page.evaluate(async (run) => {
          const context = {workspaceId:(await window.contextweave.workspace.current()).data.workspaceId}
          if(run===0) {
            const preview=await window.contextweave.batch.preview(context,{action:'start',environmentIds:['missing-target']})
            if(!preview.ok)return preview
            const confirmed=await window.contextweave.batch.confirm(context,preview.data.id)
            if(!confirmed.ok)return confirmed
          }
          return window.contextweave.batch.page(context,{beforeId:null,limit:20})
        },run)
        assert(batch.ok && batch.data.items.length===1,'BATCH_REAL_IPC_RECEIPT_LOST')
        assert.equal(batch.data.items[0].status,'completed')
        assert.equal(batch.data.items[0].counts.skipped,1)

      } finally { await desktopStage(`workspace-v${previousVersion}-close-${run}`, () => app.close(), { timeoutMs: 20000, app }) }
    }
    assert.equal(await readFile(marker, 'utf8'), 'existing browser directory: do not relocate')
    const backups = (await readdir(dataRoot)).filter(name => name.includes(`.before-v${currentSchemaVersion}-`))
    assert.equal(backups.length, previousVersion === currentSchemaVersion ? 0 : 1, 'WORKSPACE_MIGRATION_REPEATED')
    const before = previousVersion === currentSchemaVersion ? null : new DatabaseSync(join(dataRoot, backups[0]), { readOnly: true })
    const after = new DatabaseSync(file, { readOnly: true })
    try {
      if (before) assert.equal(before.prepare('PRAGMA user_version').get().user_version, previousVersion)
      assert.equal(after.prepare('PRAGMA user_version').get().user_version, currentSchemaVersion)
      assert.equal(after.prepare('SELECT workspace_id FROM local_workspace').get().workspace_id, identity.workspaceId)
      assert.equal(after.prepare('SELECT data_dir FROM environments').get().data_dir, profile)
      const revisions = after.prepare('SELECT environment_id,revision,config_json,created_at FROM environment_revisions').all()
      assert.deepEqual(revisions, originalRevisions, 'WORKSPACE_ORIGINAL_REVISIONS_CHANGED')
      if (before) assert.deepEqual(revisions, before.prepare('SELECT environment_id,revision,config_json,created_at FROM environment_revisions').all())
      assert.equal(after.prepare('SELECT revision FROM environments').get().revision, 1)
      for (const table of ['environments','environment_revisions','screenshot_budget']) assert.equal(after.prepare(`SELECT workspace_id FROM ${table}`).get().workspace_id, identity.workspaceId)
    } finally { before?.close(); after.close() }
    console.log(JSON.stringify({ workspace: `${previousVersion === currentSchemaVersion ? 'development' : 'published'}-v${previousVersion}-upgrade-restart-persisted-identity-real-switcher`, profile: 'retained-in-place', migration: previousVersion === currentSchemaVersion ? 'unchanged-current-schema-no-extra-backup' : `single-consistent-pre-v${currentSchemaVersion}-backup`, organization: 'real-ipc-group-tags-note-view-retained-on-restart', batch: 'real-ipc-confirmed-receipt-retained-on-restart' }))
  } catch (error) {
    preserveFixture = error?.preserveSmokeDirectory === true
    throw error
  } finally { if (!preserveFixture) await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) }
}
