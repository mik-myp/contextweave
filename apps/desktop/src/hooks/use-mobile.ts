import { useSyncExternalStore } from 'react'

const MOBILE_BREAKPOINT = 768
const subscribe = (onChange: () => void) => {
  const media = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
  media.addEventListener('change', onChange)
  return () => media.removeEventListener('change', onChange)
}
const snapshot = () => window.innerWidth < MOBILE_BREAKPOINT
const serverSnapshot = () => false

export function useIsMobile() {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot)
}
