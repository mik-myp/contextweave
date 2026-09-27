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
    assert(options.detail.includes(failure))
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
