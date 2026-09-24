import { useContext, useLayoutEffect, type RefObject } from 'react'
import { DataTableStateContext } from './data-table-state-context'

export function useDataTableScroll(
  ref: RefObject<HTMLElement | null>,
  stateKey: string | undefined,
  loading: boolean | undefined,
) {
  const snapshots = useContext(DataTableStateContext)
  useLayoutEffect(() => {
    const scroller = ref.current
    if (!stateKey || !snapshots || !scroller || loading) return
    scroller.scrollTop = snapshots.get(stateKey)?.scrollTop ?? 0
    const remember = () => {
      snapshots.set(stateKey, { ...snapshots.get(stateKey), scrollTop: scroller.scrollTop })
    }
    scroller.addEventListener('scroll', remember, { passive: true })
    return () => scroller.removeEventListener('scroll', remember)
  }, [loading, ref, snapshots, stateKey])
}
