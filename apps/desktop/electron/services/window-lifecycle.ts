export interface ManagedWindow {
  isDestroyed(): boolean
  isMinimized(): boolean
  restore(): void
  show(): void
  focus(): void
  destroy(): void
  once(event: 'closed' | 'ready-to-show', listener: () => void): unknown
}

/** Callbacks belong to one window; late events must never act on its replacement. */
export function createWindowLifecycle<T extends ManagedWindow>(options: {
  create(): T
  load(window: T): Promise<unknown>
  failed(error: unknown): void
}) {
  let current: T | undefined
  let enabled = false
  let stopped = false
  const get = () => (current && !current.isDestroyed() ? current : undefined)
  const show = () => {
    if (!enabled || stopped) return
    try {
      const existing = get()
      if (existing) {
        if (existing.isMinimized()) existing.restore()
        existing.show()
        existing.focus()
        return
      }
      const window = options.create()
      current = window
      window.once('closed', () => {
        if (current === window) current = undefined
      })
      window.once('ready-to-show', () => {
        if (!stopped && current === window && !window.isDestroyed()) {
          window.show()
          window.focus()
        }
      })
      void options.load(window).catch((error: unknown) => {
        // Chromium may reject loadFile before Electron finishes destroying a closing window.
        // Defer reporting until closed/quit handlers have had a chance to invalidate ownership.
        setImmediate(() => {
          if (!stopped && current === window && !window.isDestroyed()) options.failed(error)
        })
      })
    } catch (error) {
      options.failed(error)
    }
  }
  return {
    get,
    show,
    ready() {
      if (stopped) return
      enabled = true
      show()
    },
    stop() {
      stopped = true
    },
    destroy() {
      stopped = true
      const window = get()
      current = undefined
      window?.destroy()
    },
  }
}
