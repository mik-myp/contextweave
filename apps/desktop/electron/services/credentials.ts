import { randomUUID } from 'node:crypto'
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
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
    writeFileSync(temporaryPath, JSON.stringify(value), { mode: 0o600 })
    renameSync(temporaryPath, filePath)
  }
  return {
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
