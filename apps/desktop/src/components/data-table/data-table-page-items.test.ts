import { describe, expect, it } from 'vitest'
import { getPageItems } from './data-table-page-items'

describe('numbered table pagination', () => {
  it('shows every page for small result sets, with a stable empty state', () => {
    expect(getPageItems(1, 0)).toEqual([1])
    expect(getPageItems(3, 5)).toEqual([1, 2, 3, 4, 5])
    expect(getPageItems(7, 7)).toEqual([1, 2, 3, 4, 5, 6, 7])
  })

  it('keeps the ends and current neighborhood available for direct navigation', () => {
    expect(getPageItems(1, 40)).toEqual([1, 2, 3, 4, 5, 'end-ellipsis', 40])
    expect(getPageItems(20, 40)).toEqual([1, 'start-ellipsis', 19, 20, 21, 'end-ellipsis', 40])
    expect(getPageItems(40, 40)).toEqual([1, 'start-ellipsis', 36, 37, 38, 39, 40])
  })

  it('keeps page targets valid and bounded while crossing the collapsed ranges', () => {
    for (const count of [8, 9, 20, 100]) {
      for (let current = 1; current <= count; current++) {
        const items = getPageItems(current, count)
        const pages = items.filter((item): item is number => typeof item === 'number')
        expect(items.length).toBeLessThanOrEqual(7)
        expect(pages).toContain(current)
        expect(pages[0]).toBe(1)
        expect(pages.at(-1)).toBe(count)
        expect(new Set(items).size).toBe(items.length)
        expect(pages).toEqual([...pages].sort((a, b) => a - b))
      }
    }
    expect(getPageItems(5_000_000, 10_000_000).length).toBeLessThanOrEqual(7)
  })

  it('clamps stale page positions after records are removed', () => {
    expect(getPageItems(50, 9)).toEqual(getPageItems(9, 9))
    expect(getPageItems(0, 9)).toEqual(getPageItems(1, 9))
  })
})
