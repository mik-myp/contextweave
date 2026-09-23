export type PageItem = number | 'start-ellipsis' | 'end-ellipsis'

/** One-based page numbers; bounded output even for very large result sets. */
export function getPageItems(currentPage: number, pageCount: number): PageItem[] {
  const total = Math.max(1, pageCount)
  const current = Math.min(total, Math.max(1, currentPage))
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1)

  const start = current <= 4 ? 2 : current >= total - 3 ? total - 4 : current - 1
  const end = current <= 4 ? 5 : current >= total - 3 ? total - 1 : current + 1
  const items: PageItem[] = [1]
  if (start > 2) items.push('start-ellipsis')
  for (let page = start; page <= end; page++) items.push(page)
  if (end < total - 1) items.push('end-ellipsis')
  items.push(total)
  return items
}
