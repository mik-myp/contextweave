import { randomUUID } from 'node:crypto'
import {
  closeSync,
  fsyncSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { z } from 'zod'
export type SecureStorage = {
  isEncryptionAvailable(): boolean
  encryptString(value: string): Buffer
  decryptString(value: Buffer): string
}
export function createCredentialStore(filePath: string, secure: SecureStorage) {
  function readFile(): Record<string, string> {
    try {
      return z.record(z.string(), z.string()).parse(JSON.parse(readFileSync(filePath, 'utf8')))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
      // Corruption must never be mistaken for an empty store and overwritten.
      throw new Error('CREDENTIAL_STORE_UNREADABLE')
    }
  }
  function writeFile(value: Record<string, string>) {
    const temporaryPath = `${filePath}.${randomUUID()}.tmp`
    // Exclusive open happens outside cleanup: a collision is not our file to remove.
    const fd = openSync(temporaryPath, 'wx', 0o600)
    try {
      try {
        writeFileSync(fd, JSON.stringify(value))
        fsyncSync(fd)
      } finally {
        closeSync(fd)
      }
      renameSync(temporaryPath, filePath)
    } catch (error) {
      try {
        rmSync(temporaryPath, { force: true })
      } catch {
        // Startup/explicit maintenance retries cleanup without masking the write failure.
      }
      throw error
    }
  }
  return {
    cleanupTemporaryFiles() {
      const prefix = `${basename(filePath)}.`
      for (const name of readdirSync(dirname(filePath))) {
        if (!name.startsWith(prefix)) continue
        const suffix = name.slice(prefix.length)
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.tmp$/.test(suffix))
          rmSync(join(dirname(filePath), name), { force: true })
      }
    },
    save(reference: string, value: string) {
      if (!secure.isEncryptionAvailable()) throw new Error('CREDENTIAL_UNAVAILABLE')
      const data = readFile()
      data[reference] = secure.encryptString(value).toString('base64')
      writeFile(data)
    },
    read(reference: string): string | undefined {
      if (!secure.isEncryptionAvailable()) return undefined
      const encoded = readFile()[reference]
      if (!encoded) return undefined
      try {
        return secure.decryptString(Buffer.from(encoded, 'base64'))
      } catch {
        return undefined
      }
    },
    remove(reference?: string) {
      if (!reference) return
      const data = readFile()
      if (!(reference in data)) return
      delete data[reference]
      writeFile(data)
    },
  }
}
export type CredentialStore = ReturnType<typeof createCredentialStore>
