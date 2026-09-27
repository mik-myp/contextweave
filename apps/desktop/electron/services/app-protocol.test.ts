import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { APP_ENTRY_URL, createAppProtocolHandler, resolveAppAsset } from './app-protocol'
const root = resolve('fixture with spaces', 'app.asar', 'dist')
describe('restricted application asset protocol', () => {
  it('maps only the app entry and build assets inside the chosen dist directory', () => {
    expect(resolveAppAsset(APP_ENTRY_URL, 'GET', root)).toBe(resolve(root, 'index.html'))
    expect(resolveAppAsset('contextweave://app/assets/index-abc.js', 'HEAD', root)).toBe(
      resolve(root, 'assets/index-abc.js'),
    )
  })
  it.each([
    '#/proxies',
    '#/environments',
    '#/environments/env-abc',
    '#/environments?search=%E6%B5%8B%E8%AF%95',
    '#/../../private-file',
  ])('reloads a hash route using only the fixed entry asset: %s', (hash) => {
    expect(resolveAppAsset(`${APP_ENTRY_URL}${hash}`, 'GET', root)).toBe(
      resolve(root, 'index.html'),
    )
  })
  it('never passes route fragments or route query values to the native file loader', async () => {
    const fetchFile = vi.fn(async () => new Response('fixture'))
    const response = await createAppProtocolHandler(
      root,
      fetchFile,
    )(new Request(`${APP_ENTRY_URL}#/proxies?filter=%2Fprivate%2Ffile`))
    expect(response.status).toBe(200)
    expect(fetchFile).toHaveBeenCalledExactlyOnceWith(
      pathToFileURL(resolve(root, 'index.html')).href,
      'GET',
    )
  })
  it.each([
    'contextweave://app/',
    'contextweave://other/index.html',
    'contextweave://app:123/index.html',
    'contextweave://user:pass@app/index.html',
    'contextweave://app/index.html?file=other',
    'contextweave://app/index.html#fragment',
    'contextweave://app/assets/index.js#/proxies',
    'contextweave://app/%69ndex.html#/proxies',
    'contextweave://app/index.html?file=other#/proxies',
    'file:///index.html',
    'https://app/index.html',
    'contextweave://app/assets/%2e%2e/%2e%2e/package.json',
    'contextweave://app/assets/a%2fb.js',
    'contextweave://app/assets/a%5cb.js',
    'contextweave://app/assets/%00.js',
    'contextweave://app/dist-electron/main.js',
    'contextweave://app/assets/../../package.json',
    'contextweave://app/assets/.hidden.js',
    'contextweave://app/assets/subdir/a.js',
    'contextweave://app/assets/index.js.map',
    'contextweave://app/assets/a..b.js',
    'not a URL',
  ])('rejects non-assets without turning them into filesystem access: %s', (url) => {
    expect(resolveAppAsset(url, 'GET', root)).toBeUndefined()
  })
  it.each(['POST', 'DELETE', 'PUT', 'OPTIONS'])('rejects method %s', (method) => {
    expect(resolveAppAsset(APP_ENTRY_URL, method, root)).toBeUndefined()
  })
  it('delegates a safe file URL to the native ASAR loader and sets defensive headers', async () => {
    const fetchFile = vi.fn(async () => new Response('fixture'))
    const handler = createAppProtocolHandler(root, fetchFile)
    const response = await handler(new Request(APP_ENTRY_URL))
    expect(fetchFile).toHaveBeenCalledWith(pathToFileURL(resolve(root, 'index.html')).href, 'GET')
    expect(response.status).toBe(200)
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(await response.text()).toBe('fixture')
  })
  it('never fetches rejected requests or leaks native paths and errors', async () => {
    const fetchFile = vi.fn(async () => {
      throw new Error('private filesystem path')
    })
    const handler = createAppProtocolHandler(root, fetchFile)
    expect((await handler(new Request('contextweave://app/package.json'))).status).toBe(404)
    expect(fetchFile).not.toHaveBeenCalled()
    const response = await handler(new Request(APP_ENTRY_URL))
    expect(response.status).toBe(404)
    expect(await response.text()).toBe('Resource unavailable')
  })
})
