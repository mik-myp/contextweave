import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export const APP_SCHEME = 'contextweave'
export const APP_ENTRY_URL = 'contextweave://app/index.html'
const assetPath = /^\/assets\/[A-Za-z0-9][A-Za-z0-9_.-]*\.(?:js|css|woff2?|png|jpe?g|svg|ico|webp)$/

/** Only immutable build output, never profiles, Preload, Main, arbitrary paths or URLs. */
export function resolveAppAsset(url: string, method: string, distRoot: string): string | undefined {
  if ((method !== 'GET' && method !== 'HEAD') || url.includes('%') || url.includes('\\'))
    return undefined
  try {
    const request = new URL(url)
    if (
      request.protocol !== `${APP_SCHEME}:` ||
      request.hostname !== 'app' ||
      request.port ||
      request.username ||
      request.password ||
      request.search ||
      request.hash ||
      request.pathname.length > 512 ||
      request.pathname.includes('%') ||
      request.pathname.includes('..')
    )
      return undefined
    if (request.pathname !== '/index.html' && !assetPath.test(request.pathname)) return undefined
    return join(distRoot, request.pathname.slice(1))
  } catch {
    return undefined
  }
}

export function createAppProtocolHandler(
  distRoot: string,
  fetchFile: (url: string, method: string) => Promise<Response>,
) {
  return async (request: Request): Promise<Response> => {
    const path = resolveAppAsset(request.url, request.method, distRoot)
    if (!path) return new Response('Not found', { status: 404 })
    try {
      // Electron's native file/ASAR loader retains the archive integrity checks.
      // No Renderer path, arbitrary IPC or general-purpose filesystem reader is exposed.
      const response = await fetchFile(pathToFileURL(path).href, request.method)
      const headers = new Headers(response.headers)
      headers.set('X-Content-Type-Options', 'nosniff')
      headers.set('Cache-Control', 'no-store')
      return new Response(response.body, { status: response.status, headers })
    } catch {
      return new Response('Resource unavailable', { status: 404 })
    }
  }
}
