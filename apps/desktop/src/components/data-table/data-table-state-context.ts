import { createContext } from 'react'
import type { TableState } from '@tanstack/react-table'
import type { DataTableFeatures } from './data-table-features'

export type DataTableSnapshot = {
  state?: Partial<TableState<DataTableFeatures>>
  /** Opaque page token for server-paginated tables; never interpreted by shared UI. */
  pageCursor?: string | null
  scrollTop?: number
}

export const DataTableStateContext = createContext<Map<string, DataTableSnapshot> | null>(null)
