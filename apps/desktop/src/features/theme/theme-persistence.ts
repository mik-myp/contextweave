import type { ThemeConfig } from '@contextweave/contracts'

export type ThemeSaveStatus = 'saved' | 'saving' | 'error'
type SaveTheme = (config: ThemeConfig) => Promise<{ ok: boolean }>

/** One ordered writer per provider; every request settles, including IPC rejection. */
export function createThemePersistence(write: SaveTheme) {
  let queue = Promise.resolve()
  let latest: ThemeConfig | undefined
  let revision = 0
  let status: ThemeSaveStatus = 'saved'
  const listeners = new Set<() => void>()
  const publish = (next: ThemeSaveStatus) => {
    if (next === status) return
    status = next
    listeners.forEach((listener) => listener())
  }
  const save = (config: ThemeConfig) => {
    const snapshot = { ...config }
    latest = snapshot
    const request = ++revision
    publish('saving')
    queue = queue.then(async () => {
      let ok = false
      try {
        ok = (await write(snapshot)).ok
      } catch {
        // Keep the preview and expose a retryable error; never leak IPC details to UI.
      }
      if (request === revision) publish(ok ? 'saved' : 'error')
    })
    return queue
  }
  return {
    save,
    retry: () => (latest ? save(latest) : Promise.resolve()),
    getSnapshot: () => status,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
