import * as React from 'react'
import type { Notice } from '@/shared/types/app'
export type AppUiState = {
  selectedEnvironment?: string
  setSelectedEnvironment: (id: string | undefined) => void
  notice?: Notice
  setNotice: (notice: Notice | undefined) => void
  lastWorkerResult?: string
  setLastWorkerResult: (result: string | undefined) => void
}
export const AppDataContext = React.createContext<AppUiState | null>(null)
