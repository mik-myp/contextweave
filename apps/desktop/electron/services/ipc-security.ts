type Frame = { readonly url: string }
type Contents = { readonly mainFrame: Frame; isDestroyed(): boolean }
type Window = { readonly webContents: Contents; isDestroyed(): boolean }
type Sender = { readonly sender: Contents; readonly senderFrame: Frame | null }

export function isTrustedRendererUrl(value: string, expected: string): boolean {
  try {
    const actual = new URL(value)
    const entry = new URL(expected)
    if (!['file:', 'http:', 'https:'].includes(entry.protocol)) return false
    if (actual.username || actual.password || entry.username || entry.password) return false
    // The application uses hash routing. Everything before the fragment must be the exact entry.
    actual.hash = ''
    entry.hash = ''
    return actual.href === entry.href
  } catch {
    return false
  }
}

export function isTrustedIpcSender(
  event: Sender,
  window: Window | undefined,
  entryUrl: string,
  unavailable: boolean,
): boolean {
  try {
    if (unavailable || !window || window.isDestroyed() || window.webContents.isDestroyed())
      return false
    return (
      event.sender === window.webContents &&
      event.senderFrame === window.webContents.mainFrame &&
      isTrustedRendererUrl(event.senderFrame.url, entryUrl)
    )
  } catch {
    // Accessing a detached WebFrameMain may throw while a window/navigation is being destroyed.
    return false
  }
}
