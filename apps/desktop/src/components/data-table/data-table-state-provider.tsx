import { useState, type ReactNode } from 'react'
import { DataTableStateContext, type DataTableSnapshot } from './data-table-state-context'

/** List preferences live for the current app session, without retaining row data. */
export function DataTableStateProvider({ children }: { children: ReactNode }) {
  const [snapshots] = useState(() => new Map<string, DataTableSnapshot>())
  return (
    <DataTableStateContext.Provider value={snapshots}>{children}</DataTableStateContext.Provider>
  )
}
