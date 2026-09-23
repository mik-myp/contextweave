/// <reference types="vite/client" />

import type { ContextWeaveApi } from '../electron/preload'

declare global {
  interface Window {
    contextweave: ContextWeaveApi
  }
}

export {}
