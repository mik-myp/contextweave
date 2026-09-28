import { expect, it } from 'vitest'
import {
  createTagSchema,
  updateTagSchema,
  deleteTagSchema,
  environmentTagSchema,
  organizationSnapshotSchema,
} from './organization'
const owner = { workspaceId: '00000000-0000-4000-8000-000000000001' }
const tag = {
  ...owner,
  id: '00000000-0000-4000-8000-000000000010',
  name: 'Review',
  revision: 1,
  updatedAt: '2026-09-28T00:00:00.000Z',
}

it('normalizes display labels and requires a stable ID and safe revision for destructive edits', () => {
  expect(createTagSchema.parse({ name: ' E\u0301quipe ' })).toEqual({ name: 'Équipe' })
  expect(environmentTagSchema.parse(tag)).toEqual(tag)
  for (const name of ['', '  ', 'a'.repeat(41)])
    expect(createTagSchema.safeParse({ name }).success).toBe(false)
  for (const expectedRevision of [undefined, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    expect(updateTagSchema.safeParse({ id: tag.id, name: 'New', expectedRevision }).success).toBe(
      false,
    )
    expect(deleteTagSchema.safeParse({ id: tag.id, expectedRevision }).success).toBe(false)
  }
  expect(updateTagSchema.parse({ id: tag.id, expectedRevision: 1, name: ' New ' }).name).toBe('New')
  expect(createTagSchema.safeParse({ name: 'OK', workspaceId: owner.workspaceId }).success).toBe(
    false,
  )
  expect(deleteTagSchema.safeParse({ id: '../path', expectedRevision: 1 }).success).toBe(false)
  expect(
    deleteTagSchema.safeParse({ id: tag.id, expectedRevision: 1, deleteEnvironments: true })
      .success,
  ).toBe(false)
})
it('includes unused tags in the authoritative snapshot and refuses a mixed-owner catalog', () => {
  const snapshot = { ...owner, tags: [tag], environments: [], groups: [], views: [] }
  expect(organizationSnapshotSchema.parse(snapshot)).toEqual(snapshot)
  expect(
    organizationSnapshotSchema.safeParse({
      ...snapshot,
      tags: [{ ...tag, workspaceId: '00000000-0000-4000-8000-000000000002' }],
    }).success,
  ).toBe(false)
  expect(organizationSnapshotSchema.safeParse({ ...snapshot, tags: undefined }).success).toBe(false)
})
