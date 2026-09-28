import { expect, it } from 'vitest'
import { sameFileIdentity } from './file-identity'

it('compares Windows volume serials using their defined low 32 bits without ignoring identity', () => {
  const file = { dev: 0xdeadbeef12345678n, ino: 123n }
  expect(sameFileIdentity(file, { dev: 0x12345678n, ino: 123n }, 'win32')).toBe(true)
  expect(sameFileIdentity(file, { dev: 0x12345679n, ino: 123n }, 'win32')).toBe(false)
  expect(sameFileIdentity(file, { dev: 0x12345678n, ino: 124n }, 'win32')).toBe(false)
  expect(sameFileIdentity(file, { dev: 0x12345678n, ino: 123n }, 'darwin')).toBe(false)
  expect(sameFileIdentity(file, file, 'linux')).toBe(true)
})
