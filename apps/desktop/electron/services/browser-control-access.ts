/** Private Main/Worker connection metadata; never part of a Renderer command/result. */
export type BrowserControlAccess = { port: number; token: string }
export type BrowserControlLease = { access: BrowserControlAccess; revoke(): void }
export const browserControlPath = '/contextweave/browser'
export function browserControlUrl(access: BrowserControlAccess) {
  if (
    !Number.isInteger(access.port) ||
    access.port < 1 ||
    access.port > 65535 ||
    !/^[a-f0-9]{64}$/.test(access.token)
  )
    throw new Error('CONTROL_ACCESS_INVALID')
  return `ws://127.0.0.1:${access.port}${browserControlPath}`
}
