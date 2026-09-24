import type { AppLogEntry } from '@contextweave/contracts'

export type LogFilters = {
  level: 'all' | AppLogEntry['level']
  source: 'all' | AppLogEntry['source']
  method: string
  query: string
  from: string
  to: string
  minDuration: string
}

export const defaultLogFilters: LogFilters = {
  level: 'all',
  source: 'all',
  method: 'all',
  query: '',
  from: '',
  to: '',
  minDuration: '',
}

export function hasLogFilters(filters: LogFilters) {
  return Object.entries(defaultLogFilters).some(
    ([key, value]) => filters[key as keyof LogFilters] !== value,
  )
}

export function hasInvalidLogTimeRange(filters: Pick<LogFilters, 'from' | 'to'>) {
  const from = filters.from ? new Date(filters.from).getTime() : -Infinity
  const to = filters.to ? new Date(filters.to).getTime() : Infinity
  return Number.isNaN(from) || Number.isNaN(to) || from > to
}

export function filterAppLogs(
  entries: AppLogEntry[],
  filters: LogFilters,
  describe: (entry: AppLogEntry) => string,
) {
  if (hasInvalidLogTimeRange(filters)) return []
  const from = filters.from ? new Date(filters.from).getTime() : -Infinity
  // datetime-local has minute precision. Include the entire ending minute.
  const to = filters.to ? new Date(filters.to).getTime() + 59_999 : Infinity
  const minDuration = Number(filters.minDuration)
  const terms = filters.query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  return entries.filter((entry) => {
    if (filters.level !== 'all' && entry.level !== filters.level) return false
    if (filters.source !== 'all' && entry.source !== filters.source) return false
    if (filters.method !== 'all' && entry.method !== filters.method) return false
    const timestamp = new Date(entry.timestamp).getTime()
    if (timestamp < from || timestamp > to) return false
    if (
      filters.minDuration &&
      Number.isFinite(minDuration) &&
      minDuration >= 0 &&
      (entry.durationMs === undefined || entry.durationMs < minDuration)
    )
      return false
    if (!terms.length) return true
    const text = [
      entry.event,
      entry.source,
      entry.level,
      entry.method,
      entry.errorCode,
      entry.fields.resourceId,
      entry.fields.status,
      describe(entry),
    ]
      .join(' ')
      .toLocaleLowerCase()
    return terms.every((term) => text.includes(term))
  })
}
