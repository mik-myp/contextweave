import { useMemo, useState, type ReactNode } from 'react'
import { EnvironmentDraftContext, type EnvironmentDraft } from './environment-draft-context'

export function EnvironmentDraftProvider({ children }: { children: ReactNode }) {
  const [drafts] = useState(() => new Map<string, EnvironmentDraft>())
  const [resumeId, setResumeId] = useState<string>()
  const [savedId, setSavedId] = useState<string>()
  const value = useMemo(
    () => ({ drafts, resumeId, setResumeId, savedId, setSavedId }),
    [drafts, resumeId, savedId],
  )
  return (
    <EnvironmentDraftContext.Provider value={value}>{children}</EnvironmentDraftContext.Provider>
  )
}
