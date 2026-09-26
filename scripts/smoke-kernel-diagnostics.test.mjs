import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { ChildProcess } from 'node:child_process'
import files from 'node:fs'
import promises from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'
import { ReadableStream, ReadableStreamDefaultReader } from 'node:stream/web'
import { test } from 'node:test'
import {
  installKernelDiagnostics,
  readKernelDiagnostics,
  restoreKernelDiagnostics,
} from './smoke-kernel-diagnostics.mjs'

const desktop = { evaluate: (fn) => Promise.resolve(fn()) }
const secret = 'CANARY_CREDENTIAL_PATH_AND_ERROR_MUST_NOT_ESCAPE'

test('kernel failure evidence is bounded and redacted, preserving errors and restoring hooks', async () => {
  const originals = {
    fetch: globalThis.fetch,
    rm: promises.rm,
    read: ReadableStreamDefaultReader.prototype.read,
  }
  const networkError = new TypeError(secret, { cause: { code: 'ECONNRESET', path: secret } })
  const fileError = Object.assign(new Error(secret), { code: 'EACCES', path: secret })
  const fetch = async (url) => {
    if (url.includes('failure')) throw networkError
    return { status: 200, body: secret, url }
  }
  const rm = async () => {
    throw fileError
  }
  globalThis.fetch = fetch
  promises.rm = rm
  syncBuiltinESMExports()
  await installKernelDiagnostics(desktop)
  try {
    const response = await globalThis.fetch(`https://github.com/${secret}?token=${secret}`)
    assert.equal(response.body, secret)
    await assert.rejects(
      globalThis.fetch(`https://${secret}.invalid/failure`),
      (error) => error === networkError,
    )
    await assert.rejects(promises.rm(secret), (error) => error === fileError)
    const reader = new ReadableStream({
      start(controller) {
        controller.error(networkError)
      },
    }).getReader()
    await assert.rejects(reader.read(), (error) => error === networkError)
    reader.releaseLock()
    const records = await readKernelDiagnostics(desktop)
    assert.deepEqual(
      records.map(({ atMs, ...record }) => record),
      [
        { operation: 'fetch', source: 'github', status: 200 },
        { operation: 'fetch', source: 'other', code: 'ECONNRESET' },
        { operation: 'rm', code: 'EACCES' },
        { operation: 'body-read', code: 'ECONNRESET' },
      ],
    )
    assert.equal(JSON.stringify(records).includes(secret), false)
    for (let index = 0; index < 80; index++) await globalThis.fetch(`https://github.com/${secret}`)
    assert.equal((await readKernelDiagnostics(desktop)).length, 64)
  } finally {
    await restoreKernelDiagnostics(desktop)
    assert.equal(globalThis.fetch, fetch)
    assert.equal(promises.rm, rm)
    assert.equal(ReadableStreamDefaultReader.prototype.read, originals.read)
    globalThis.fetch = originals.fetch
    promises.rm = originals.rm
    syncBuiltinESMExports()
  }
  assert.deepEqual(await readKernelDiagnostics(desktop), [])
})

test('kernel process and write diagnostics record only static operations and safe codes', async () => {
  const originals = {
    spawn: ChildProcess.prototype.spawn,
    createWriteStream: files.createWriteStream,
  }
  const spawn = () => 0
  const createWriteStream = () => new EventEmitter()
  ChildProcess.prototype.spawn = spawn
  files.createWriteStream = createWriteStream
  await installKernelDiagnostics(desktop)
  try {
    const child = new ChildProcess()
    assert.equal(child.spawn({ file: '/usr/bin/hdiutil', args: ['attach', secret] }), 0)
    child.emit('exit', 1, null)
    child.emit('error', Object.assign(new Error(secret), { code: secret }))
    const stream = files.createWriteStream(secret)
    stream.emit('error', Object.assign(new Error(secret), { code: 'ENOSPC', path: secret }))
    const records = await readKernelDiagnostics(desktop)
    assert.deepEqual(
      records.map(({ atMs, ...record }) => record),
      [
        { operation: 'dmg-attach', exitCode: 1, signal: null },
        { operation: 'dmg-attach', code: 'UNCLASSIFIED' },
        { operation: 'file-write-stream', code: 'ENOSPC' },
      ],
    )
    assert.equal(JSON.stringify(records).includes(secret), false)
  } finally {
    await restoreKernelDiagnostics(desktop)
    assert.equal(ChildProcess.prototype.spawn, spawn)
    assert.equal(files.createWriteStream, createWriteStream)
    ChildProcess.prototype.spawn = originals.spawn
    files.createWriteStream = originals.createWriteStream
    syncBuiltinESMExports()
  }
})
