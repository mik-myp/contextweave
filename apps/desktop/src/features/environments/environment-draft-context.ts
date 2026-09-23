import { createContext, useContext } from 'react'
import type { EnvironmentFormValues } from './environment-form'

export type EnvironmentDraft = { values: EnvironmentFormValues; defaults: EnvironmentFormValues }
export type EnvironmentDraftStore = {
  drafts: Map<string, EnvironmentDraft>
  resumeId: string | undefined
  setResumeId: (id: string | undefined) => void
  savedId: string | undefined
  setSavedId: (id: string | undefined) => void
}
export const EnvironmentDraftContext = createContext<EnvironmentDraftStore | null>(null)
export function useEnvironmentDrafts() {
  const value = useContext(EnvironmentDraftContext)
  if (!value) throw new Error('EnvironmentDraftProvider is required')
  return value
}
