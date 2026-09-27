// Exercise the real bundled Main in isolated data roots, intercepting only native dialog/shell UI.
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import assert from 'node:assert/strict'
const require = createRequire(new URL('../apps/desktop/package.json', import.meta.url))
const main = new URL('../apps/desktop/dist-electron/main.js', import.meta.url).href
for (const failure of [
  'DATABASE_CORRUPT',
  'DATABASE_VERSION_UNSUPPORTED',
  'DATABASE_INTEGRITY_FAILED',
  'DATABASE_SCHEMA_UNSUPPORTED',
  'FINAL_DOMAIN_VALIDATION',
]) {
  const root = await mkdtemp(join(tmpdir(), 'cw-startup-smoke-'))
  try {
    const dataRoot = join(root, 'contextweave')
    await mkdir(dataRoot)
    const file = join(dataRoot, 'contextweave.sqlite')
    if (failure === 'DATABASE_CORRUPT')
      await writeFile(file, 'fixture private data: retain this original')
    else if (failure === 'DATABASE_INTEGRITY_FAILED') {
      const db = new DatabaseSync(file)
      try {
        db.exec(
          await readFile(
            new URL('../packages/storage/test-fixtures/schema-v4.sql', import.meta.url),
            'utf8',
          ),
        )
        db.exec(`INSERT INTO proxies(proxy_id,type,host,port,credential_ref,created_at,updated_at,name)
          VALUES('invalid','http','proxy.example.test',-1,'fixture private data','2026-01-01','2026-01-01','preserved')`)
      } finally {
        db.close()
      }
    } else if (failure === 'FINAL_DOMAIN_VALIDATION') {
      const db = new DatabaseSync(file)
      try {
        db.exec(await readFile(new URL('../packages/storage/test-fixtures/schema-v12.sql', import.meta.url), 'utf8'))
        db.prepare(`INSERT INTO environment_groups(group_id,name,name_key,revision,updated_at) VALUES(?,?,'wrong-key',1,'2026-09-27T00:00:00.000Z')`).run('df7f011b-a755-48d1-8967-c604fc6b07cc','fixture private data')
      } finally { db.close() }
    } else if (failure === 'DATABASE_SCHEMA_UNSUPPORTED') {
      const db = new DatabaseSync(file)
      db.exec('PRAGMA user_version=-1')
      db.close()
    } else {
      const db = new DatabaseSync(file)
      db.exec(
        "CREATE TABLE future_data (value TEXT); INSERT INTO future_data VALUES ('fixture private data'); PRAGMA user_version = 999;",
      )
      db.close()
    }
    const before = await readFile(file)
    const events = join(root, 'dialog-events.jsonl')
    const bootstrap = join(root, 'bootstrap.cjs')
    await writeFile(
      bootstrap,
      `
      const { dialog, shell } = require('electron');
      const { appendFileSync } = require('node:fs');
      const record = (data) => appendFileSync(${JSON.stringify(events)}, JSON.stringify(data) + '\\n');
      let dialogs = 0;
      dialog.showMessageBox = async (options) => { record({type:'dialog', options}); return {response: ++dialogs === 1 ? 1 : 2}; };
      shell.openPath = async (path) => { record({type:'open-folder', path}); return ''; };
      import(${JSON.stringify(main)});
    `,
    )
    await new Promise((resolve, reject) => {
      const child = spawn(require('electron'), [bootstrap], {
        env: { ...process.env, CONTEXTWEAVE_USER_DATA: root },
        cwd: fileURLToPath(new URL('../apps/desktop/', import.meta.url)),
        stdio: ['ignore', 'ignore', 'pipe'],
      })
      let stderr = ''
      child.stderr.on('data', (chunk) => {
        if (stderr.length < 8192) stderr += chunk.toString()
      })
      const timer = setTimeout(() => {
        child.kill()
        reject(new Error('Startup recovery did not exit within 20s'))
      }, 20000)
      child.once('error', (error) => {
        clearTimeout(timer)
        reject(error)
      })
      child.once('exit', (code) => {
        clearTimeout(timer)
        code === 0 ? resolve() : reject(new Error(`Startup recovery exited ${code}: ${stderr}`))
      })
    })
    const observed = (await readFile(events, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    assert.deepEqual(
      observed.map((event) => event.type),
      ['dialog', 'open-folder', 'dialog'],
    )
    const options = observed[0].options
    assert.equal(options.type, 'error')
    assert.equal(options.cancelId, 2)
    assert.equal(options.buttons.length, 3)
    assert(options.detail.includes(failure === 'FINAL_DOMAIN_VALIDATION' ? 'DATABASE_INTEGRITY_FAILED' : failure))
    assert(!JSON.stringify(options).includes('fixture private data'))
    assert.equal(observed[1].path, dataRoot)
    const backups = (await readdir(dataRoot)).filter((name) => name.endsWith('.bak'))
    if (failure === 'DATABASE_INTEGRITY_FAILED') {
      // WAL mode may change file headers. Verify exact logical data and schema in
      // both the refused original and its consistent pre-migration copy instead.
      assert.equal(backups.length, 1)
      for (const path of [file, join(dataRoot, backups[0])]) {
        const db = new DatabaseSync(path)
        try {
          assert.equal(db.prepare('PRAGMA user_version').get().user_version, 4)
          const row = db.prepare('SELECT * FROM proxies').get()
          assert.equal(row.port, -1)
          assert.equal(row.credential_ref, 'fixture private data')
          assert.equal(row.name, 'preserved')
          assert.equal(
            db.prepare("SELECT count(*) AS total FROM sqlite_schema WHERE name GLOB 'next_*'").get()
              .total,
            0,
          )
        } finally {
          db.close()
        }
      }
    } else if (failure === 'FINAL_DOMAIN_VALIDATION') {
      assert.equal(backups.length, 1, 'FINAL_VALIDATION_MUST_KEEP_PRE_MIGRATION_COPY')
      for (const path of [file, join(dataRoot, backups[0])]) {
        const db = new DatabaseSync(path, { readOnly: true })
        try {
          assert.equal(db.prepare('PRAGMA user_version').get().user_version, 12, 'FINAL_VALIDATION_MUST_ROLL_BACK_VERSION')
          assert.equal(db.prepare("SELECT name FROM sqlite_schema WHERE name='environment_commands'").get(), undefined, 'FINAL_VALIDATION_MUST_ROLL_BACK_DDL')
          assert.equal(db.prepare('SELECT name FROM environment_groups').get().name, 'fixture private data')
          assert.equal(db.prepare('SELECT name_key FROM environment_groups').get().name_key, 'wrong-key')
        } finally { db.close() }
      }
    } else {
      assert.deepEqual(
        await readFile(file),
        before,
        `${failure} must preserve original database bytes`,
      )
      assert.equal(backups.length, 0)
    }
    console.log(
      JSON.stringify({
        startupFailure: failure,
        dialog: 'passed',
        openDataFolder: 'passed',
        originalData: 'preserved',
      }),
    )
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
}

await import('./smoke-history.mjs')
