// Optional isolated research, never a product/server dependency. No external DB/S3 endpoints accepted.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, isAbsolute } from 'node:path'
import { once } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'

const arguments_ = process.argv.slice(2)
assert(arguments_.length === 2 && arguments_[0].startsWith('--pg-bin=') && arguments_[1].startsWith('--browser='),
  'Usage: node scripts/probe-team-feasibility.mjs --pg-bin=/absolute/bin --browser=/absolute/browser')
const pgBin = arguments_[0].slice('--pg-bin='.length), executablePath = arguments_[1].slice('--browser='.length)
assert(isAbsolute(pgBin) && isAbsolute(executablePath), 'Only explicit local executables are supported')
const root = await mkdtemp(join(tmpdir(), 'cw-team-probe-'))
const socket = join(root, 'socket'), cluster = join(root, 'cluster'), port = '55432'
const env = { PATH: process.env.PATH, HOME: root, LANG: 'C', TMPDIR: root, PGCONNECT_TIMEOUT: '3' }
// Do not inherit PGHOST/PGSERVICE/PGOPTIONS or anyone's production credentials/configuration.
async function run(binary, args, input = '', additions = {}) {
  const child = spawn(binary, args, { env: { ...env, ...additions }, stdio: ['pipe', 'pipe', 'pipe'] })
  let out = '', err = ''
  child.stdout.on('data', data => { out += data })
  child.stderr.on('data', data => { err += data })
  child.stdin.on('error', () => {}) // A refused login may close stdin before the fixture is sent.
  const timeout = setTimeout(() => child.kill('SIGKILL'), 15000)
  try { child.stdin.end(input); const [code] = await once(child, 'close'); return { code, out: out.trim(), err } }
  finally { clearTimeout(timeout) }
}
const passwords = Object.fromEntries(['cw_admin', 'cw_alice', 'cw_bob'].map(role => [role, randomBytes(32).toString('hex')]))
const passwordFiles = {}
let server, serverExited, canRemove = true, firstBrowser, secondBrowser
const report = { kind: 'isolated-feasibility-not-team-delivery', database: {}, checks: [],
  T02: { status: 'not-validated', blocker: 'No admitted S3 deployment supplied; independent object authorization/revocation/committed-object protection have not been run.' },
  T04: { status: 'not-validated', blocker: 'No PG/S3 coordinated member credential issuance, rotation and partial-failure revocation mechanism is admitted. No shared admin secret may be shipped.' } }
try {
  await mkdir(socket, { mode: 0o700 })
  const adminPassword = join(root, 'admin-password')
  await writeFile(adminPassword, passwords.cw_admin, { mode: 0o600 })
  for (const [role, password] of Object.entries(passwords)) {
    passwordFiles[role] = join(root, `${role}.pgpass`)
    await writeFile(passwordFiles[role], `${socket}:${port}:postgres:${role}:${password}\n`, { mode: 0o600 })
  }
  const version = await run(join(pgBin, 'postgres'), ['--version'])
  assert.equal(version.code, 0, 'PostgreSQL executable unavailable')
  report.database = { version: version.out, transport: 'private-unix-socket-only', authentication: 'SCRAM-SHA-256', fixtureRoles: 'per-member-non-superuser-non-bypassrls', productionTLS: 'not-tested-local-socket' }
  const init = await run(join(pgBin, 'initdb'), ['-D', cluster, '--no-locale', '--encoding=UTF8', '--username=cw_admin', '--auth-local=scram-sha-256', '--auth-host=reject', `--pwfile=${adminPassword}`])
  assert.equal(init.code, 0, 'Failed to initialize isolated cluster (output withheld: may include fixture secrets)')
  server = spawn(join(pgBin, 'postgres'), ['-D', cluster, '-k', socket, '-h', '', '-p', port, '-c', 'unix_socket_permissions=0700'], { env, stdio: 'ignore' })
  serverExited = once(server, 'exit')
  const sql = (role, input, override = {}) => run(join(pgBin, 'psql'), ['-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-h', socket, '-p', port, '-U', role, '-d', 'postgres'], input, { PGPASSFILE: passwordFiles[role], ...override })
  let ready = false
  for (let attempt = 0; attempt < 40; attempt++) {
    if (server.exitCode !== null || server.signalCode !== null) break
    if ((await sql('cw_admin', 'SELECT 1')).code === 0) { ready = true; break }
    await delay(100)
  }
  assert(ready, 'Isolated PostgreSQL did not become ready')
  async function pass(role, input, expected, label) {
    const result = await sql(role, input)
    assert.equal(result.code, 0, `${label}: SQL refused (raw output withheld)`)
    if (expected !== undefined) assert.equal(result.out, expected, label)
    report.checks.push(label)
    return result.out
  }
  async function refuse(role, input, pattern, label) {
    const result = await sql(role, input)
    assert.notEqual(result.code, 0, `${label}: unexpectedly allowed`)
    assert(pattern.test(result.err), `${label}: wrong refusal category`)
    report.checks.push(label)
  }
  const roles = `CREATE ROLE cw_alice LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD '${passwords.cw_alice}';\nCREATE ROLE cw_bob LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD '${passwords.cw_bob}';\n`
  const setup = await sql('cw_admin', roles + await readFile(new URL('./fixtures/team-postgresql.sql', import.meta.url), 'utf8'))
  assert.equal(setup.code, 0, 'Research SQL setup failed (raw output withheld)')
  const forgedLogin = await sql('cw_bob', 'SELECT 1', { PGPASSFILE: passwordFiles.cw_alice, PGPASSWORD: passwords.cw_alice })
  assert.notEqual(forgedLogin.code, 0, 'A different member password authenticated Bob')
  assert(/password authentication failed/.test(forgedLogin.err), 'Login did not fail at authentication')
  report.checks.push('wrong-member-password-rejected')
  await pass('cw_alice', 'SELECT session_user,current_user', 'cw_alice|cw_alice', 'independent-authenticated-login')
  await pass('cw_alice', "SELECT workspace_id,name FROM cw.environments", 'workspace-a|Alice data', 'direct-sql-cross-workspace-read-filtered')
  await pass('cw_bob', "SELECT workspace_id,name FROM cw.environments", 'workspace-b|Bob data', 'second-member-positive-control')
  await pass('cw_alice', "SET cw.actor='cw_bob'; SELECT workspace_id FROM cw.environments", 'workspace-a', 'client-actor-variable-cannot-forge-identity')
  await refuse('cw_alice', 'SET SESSION AUTHORIZATION cw_bob', /permission denied/, 'session-identity-forgery-refused')
  await refuse('cw_alice', 'SET ROLE cw_owner', /permission denied/, 'owner-role-forgery-refused')
  await refuse('cw_alice', 'SET row_security=off; SELECT * FROM cw.environments', /row-level security/, 'rls-disable-cannot-bypass')
  await refuse('cw_alice', 'SELECT * FROM cw.memberships', /permission denied/, 'membership-authority-is-private')
  await refuse('cw_alice', "UPDATE cw.environments SET name='forged'", /permission denied/, 'direct-dml-refused')
  await refuse('cw_alice', 'ALTER TABLE cw.environments DISABLE ROW LEVEL SECURITY', /must be owner/, 'member-cannot-migrate')
  await refuse('cw_alice', "CREATE OR REPLACE FUNCTION cw.can_access(w text,e text) RETURNS boolean LANGUAGE sql AS 'SELECT true'", /permission denied|must be owner/, 'member-cannot-replace-authorization')
  await pass('cw_alice', "SELECT cw.rename_environment('workspace-a','same-id','Alice changed',1)", '2', 'controlled-write-positive-control')
  await refuse('cw_alice', "SELECT cw.rename_environment('workspace-b','same-id','forged',1)", /CW_DENIED_OR_STALE/, 'controlled-write-cannot-cross-space')
  await refuse('cw_alice', "SELECT cw.rename_environment('workspace-a','same-id','stale',1)", /CW_DENIED_OR_STALE/, 'stale-revision-refused')
  await pass('cw_admin', "UPDATE cw.memberships SET active=false WHERE principal='cw_alice'", '', 'database-membership-revoked')
  await pass('cw_alice', 'SELECT count(*) FROM cw.environments', '0', 'revoked-member-cannot-read-with-valid-login')
  await refuse('cw_alice', "SELECT cw.rename_environment('workspace-a','same-id','forged',2)", /CW_DENIED_OR_STALE/, 'revoked-member-cannot-write')
  report.T01 = { status: 'bounded-prototype-passed', limitation: 'One local PostgreSQL deployment only; not production TLS, provisioning or a full team authorization audit.' }
  // T03 counterexample: a still-running browser does not stop when a DB lease expires.
  await pass('cw_admin', "UPDATE cw.memberships SET active=true WHERE principal='cw_alice'; INSERT INTO cw.memberships VALUES('workspace-a','same-id','cw_bob',true)", '', 'shared-environment-fixture-authorized')
  const require = createRequire(new URL('../apps/desktop/package.json', import.meta.url))
  const { chromium } = require('playwright-core')
  firstBrowser = await chromium.launch({ executablePath, headless: true, timeout: 15000 })
  const firstPage = await firstBrowser.newPage()
  await firstPage.setContent('<title>Isolated old lease browser</title>')
  await pass('cw_alice', "SELECT cw.unsafe_ttl_claim('workspace-a','same-id')", '1', 'first-generation-claimed')
  await refuse('cw_bob', "SELECT cw.unsafe_ttl_claim('workspace-a','same-id')", /CW_BUSY/, 'nonexpired-lease-refused')
  await pass('cw_admin', 'SELECT pg_sleep(1.2)', '', 'real-server-clock-lease-expired')
  await pass('cw_bob', "SELECT cw.unsafe_ttl_claim('workspace-a','same-id')", '2', 'naive-ttl-admitted-second-generation')
  await refuse('cw_bob', "SELECT cw.commit_if_fenced('workspace-a','same-id',1)", /CW_DENIED_OR_STALE/, 'current-holder-cannot-submit-old-generation')
  await pass('cw_bob', "SELECT cw.commit_if_fenced('workspace-a','same-id',2)", 't', 'current-generation-positive-control')
  secondBrowser = await chromium.launch({ executablePath, headless: true, timeout: 15000 })
  const secondPage = await secondBrowser.newPage()
  await secondPage.setContent('<title>Isolated replacement browser</title>')
  assert.equal(await firstPage.title(), 'Isolated old lease browser')
  assert.equal(await secondPage.title(), 'Isolated replacement browser')
  assert(firstBrowser.isConnected() && secondBrowser.isConnected())
  await refuse('cw_alice', "SELECT cw.commit_if_fenced('workspace-a','same-id',1)", /CW_DENIED_OR_STALE/, 'old-generation-commit-refused')
  report.T03 = { status: 'ttl-only-takeover-disproved', browserVersion: firstBrowser.version(), bothIndependentBrowsersAliveAfterExpiry: true,
    staleGenerationCommit: 'refused', disconnectAndOperatingSystemSleep: 'not-injected',
    blocker: 'Fencing rejects stale commits but cannot prove the previous browser stopped; online admission, safe disconnect/stop evidence and abnormal takeover remain prerequisites.' }
} finally {
  try { if (secondBrowser) await secondBrowser.close(); if (firstBrowser) await firstBrowser.close() }
  catch { canRemove = false }
  if (server && server.exitCode === null && server.signalCode === null) {
    server.kill('SIGINT')
    try { await Promise.race([serverExited, delay(10000, undefined, { ref: false }).then(() => { throw new Error('SERVER_STOP_TIMEOUT') })]) }
    catch { canRemove = false }
  }
  if (canRemove) await rm(root, { recursive: true, force: true })
  else throw new Error(`TEST_PROCESS_STOP_UNCONFIRMED; retained private synthetic fixture at ${root}`)
}
console.log(JSON.stringify(report, null, 2))
