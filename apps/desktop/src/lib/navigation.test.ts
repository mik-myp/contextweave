import { describe, expect, it } from 'vitest'
import { isRouteActive } from './navigation'

describe('active navigation', () => {
  it.each(['/environments', '/environments/new', '/environments/env-001/edit'])(
    'keeps the environment module selected at %s',
    (pathname) => expect(isRouteActive(pathname, '/environments')).toBe(true),
  )
  it('does not select sibling prefixes or the home route for every page', () => {
    expect(isRouteActive('/environments-archived', '/environments')).toBe(false)
    expect(isRouteActive('/proxies', '/environments')).toBe(false)
    expect(isRouteActive('/environments', '/')).toBe(false)
    expect(isRouteActive('/', '/')).toBe(true)
  })
})
