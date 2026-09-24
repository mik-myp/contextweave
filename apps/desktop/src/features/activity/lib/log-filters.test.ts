import { describe, expect, it } from 'vitest'
import type { AppLogEntry } from '@contextweave/contracts'
import {
  defaultLogFilters,
  filterAppLogs,
  hasInvalidLogTimeRange,
  hasLogFilters,
} from './log-filters'

const entries: AppLogEntry[] = [
  {
    id: 1,
    timestamp: '2026-09-24T02:01:00.000Z',
    level: 'info',
    source: 'app',
    event: 'app-started',
    fields: {},
  },
  {
    id: 2,
    timestamp: '2026-09-24T02:02:59.999Z',
    level: 'error',
    source: 'proxy',
    event: 'command-failed',
    method: 'proxy:test',
    durationMs: 2500,
    errorCode: 'PROXY_TEST_FAILED',
    fields: { resourceId: 'proxy-test' },
  },
  {
    id: 3,
    timestamp: '2026-09-24T02:03:00.000Z',
    level: 'info',
    source: 'environment',
    event: 'environment-state',
    fields: { resourceId: 'env-test', status: 'running' },
  },
]
const describeEntry = (entry: AppLogEntry) =>
  entry.source === 'proxy' ? '代理测试失败' : '应用事件'

describe('log filters', () => {
  it('keeps chronological order without mutating entries', () => {
    expect(filterAppLogs(entries, defaultLogFilters, describeEntry)).toEqual(entries)
    expect(hasLogFilters(defaultLogFilters)).toBe(false)
    expect(hasLogFilters({ ...defaultLogFilters, level: 'error' })).toBe(true)
  })
  it('combines severity, module, method, duration and localized search', () => {
    const filters = {
      ...defaultLogFilters,
      level: 'error' as const,
      source: 'proxy' as const,
      method: 'proxy:test',
      minDuration: '1000',
      query: '代理测试 PROXY_TEST_FAILED proxy-test',
    }
    expect(filterAppLogs(entries, filters, describeEntry).map((entry) => entry.id)).toEqual([2])
    expect(filterAppLogs(entries, { ...filters, source: 'environment' }, describeEntry)).toEqual([])
  })
  it('includes the entire end minute and rejects reversed or invalid time ranges', () => {
    const filters = { ...defaultLogFilters, from: '2026-09-24T02:02Z', to: '2026-09-24T02:02Z' }
    expect(filterAppLogs(entries, filters, describeEntry).map((entry) => entry.id)).toEqual([2])
    expect(hasInvalidLogTimeRange({ from: filters.to, to: '2026-09-24T02:01Z' })).toBe(true)
    expect(filterAppLogs(entries, { ...filters, from: 'invalid' }, describeEntry)).toEqual([])
  })
  it('does not treat records with no duration as zero-duration commands', () => {
    expect(
      filterAppLogs(entries, { ...defaultLogFilters, minDuration: '0' }, describeEntry).map(
        (entry) => entry.id,
      ),
    ).toEqual([2])
    expect(
      filterAppLogs(entries, { ...defaultLogFilters, minDuration: '3000' }, describeEntry),
    ).toEqual([])
    expect(
      filterAppLogs(entries, { ...defaultLogFilters, query: 'RUNNING' }, describeEntry).map(
        (entry) => entry.id,
      ),
    ).toEqual([3])
  })
})
