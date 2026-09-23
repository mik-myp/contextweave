import * as React from 'react'
import { AppDataContext } from './app-data-context'

export function useAppData() {
  const context = React.useContext(AppDataContext)
  if (!context) throw new Error('useAppData must be used within AppDataProvider')
  return context
}
