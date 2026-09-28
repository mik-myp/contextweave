import { expect, it } from 'vitest'
import {
  installKernelSchema,
  bulkDeleteResultSchema,
  deleteTagsSchema,
  deleteKernelsSchema,
  renameKernelSchema,
} from './management'
const tag = { id: '00000000-0000-4000-8000-000000000001', expectedRevision: 1 }
it('validates a bounded, unique set of owned tag revision requests before any deletion', () => {
  expect(deleteTagsSchema.parse([tag])).toEqual([tag])
  for (const input of [
    [],
    [tag, tag],
    [{ ...tag, expectedRevision: 0 }],
    [{ ...tag, deleteEnvironments: true }],
    Array(201).fill(tag),
  ])
    expect(deleteTagsSchema.safeParse(input).success).toBe(false)
})
it('does not allow paths, duplicate kernel identities or unbounded requests', () => {
  expect(deleteKernelsSchema.parse(['standard-chromium'])).toEqual(['standard-chromium'])
  for (const input of [
    [],
    ['../profile'],
    ['file:///profile'],
    ['one', 'one'],
    Array(201).fill('one'),
  ])
    expect(deleteKernelsSchema.safeParse(input).success).toBe(false)
})
it('allows clearing a display name but never mutating identity/version or accepting control characters', () => {
  expect(renameKernelSchema.parse({ id: 'standard-chromium', name: ' Custom ' })).toEqual({
    id: 'standard-chromium',
    name: 'Custom',
  })
  expect(renameKernelSchema.parse({ id: 'standard-chromium', name: '' }).name).toBe('')
  for (const patch of [
    { name: 'x'.repeat(81) },
    { name: 'x\ny' },
    { path: '/private' },
    { version: 'other' },
  ])
    expect(
      renameKernelSchema.safeParse({ id: 'standard-chromium', name: 'Name', ...patch }).success,
    ).toBe(false)
})
it('keeps item failures explicit and rejects raw error text in public receipts', () => {
  expect(
    bulkDeleteResultSchema.parse([
      { id: 'one', ok: true },
      { id: 'two', ok: false, code: 'KERNEL_IN_USE' },
    ]),
  ).toHaveLength(2)
  expect(
    bulkDeleteResultSchema.safeParse([{ id: 'one', ok: false, code: '/private/secret' }]).success,
  ).toBe(false)
})

it('validates an optional installation name with the same constraints as renaming', () => {
  expect(installKernelSchema.parse({ id: 'managed-one', name: ' Work browser ' })).toEqual({
    id: 'managed-one',
    name: 'Work browser',
  })
  expect(installKernelSchema.parse({ id: 'managed-one' })).toEqual({ id: 'managed-one' })
  expect(installKernelSchema.parse({ id: 'managed-one', name: '' }).name).toBe('')
  for (const value of [
    { id: '../outside' },
    { id: 'managed-one', name: 'x'.repeat(81) },
    { id: 'managed-one', name: 'x\ny' },
    { id: 'managed-one', path: '/private' },
  ])
    expect(installKernelSchema.safeParse(value).success).toBe(false)
})
