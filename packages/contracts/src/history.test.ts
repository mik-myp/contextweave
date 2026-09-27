import { describe, expect, it } from 'vitest'
import {
  activityHistoryQuerySchema,
  operationHistoryQuerySchema,
  activityHistoryPageSchema,
} from './index'

describe('history request boundary', () => {
  it('normalizes defaults and status sets without accepting arbitrary SQL fields', () => {
    expect(activityHistoryQuerySchema.parse({})).toEqual({
      limit: 20,
      search: '',
      direction: 'desc',
      cursor: null,
      sortBy: 'startedAt',
      statuses: [],
    })
    expect(
      activityHistoryQuerySchema.parse({
        statuses: ['running', 'crashed', 'running'],
        search: '  École ',
      }),
    ).toMatchObject({ statuses: ['crashed', 'running'], search: 'École' })
  })
  it.each([
    { limit: 0 },
    { limit: 101 },
    { limit: 1.5 },
    { limit: '20' },
    { search: 'x'.repeat(201) },
    { statuses: ['unknown'] },
    { sortBy: 'pid' },
    { sortBy: 'started_at; DROP TABLE operations' },
    { direction: 'DESC;--' },
    { cursor: '' },
    { cursor: 'x'.repeat(2049) },
    { cursor: 'e30=' },
    { sql: 'SELECT *' },
    null,
    [],
  ])('rejects invalid history input %j', (input) => {
    expect(activityHistoryQuerySchema.safeParse(input).success).toBe(false)
    expect(operationHistoryQuerySchema.safeParse(input).success).toBe(false)
  })
  it('requires bounded, well-formed page metadata', () => {
    expect(
      activityHistoryPageSchema.safeParse({ items: [], previousCursor: null, nextCursor: null })
        .success,
    ).toBe(true)
    expect(activityHistoryPageSchema.safeParse({ items: [] }).success).toBe(false)
    expect(
      activityHistoryPageSchema.safeParse({
        items: [],
        previousCursor: null,
        nextCursor: null,
        pid: 1,
      }).success,
    ).toBe(false)
  })
})
