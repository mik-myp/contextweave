import { useWorkspaceSession } from '@/features/workspaces/workspace-session-context'
import { createDraftStore } from './draft-storage'
import { useMemo, useState, type ReactNode } from 'react'
import { EnvironmentDraftContext } from './environment-draft-context'

export function EnvironmentDraftProvider({ children }: { children: ReactNode }) {
  const { context, legacyDraftOwner } = useWorkspaceSession()
  const [drafts] = useState(() => {
    try {
      return createDraftStore(
        context,
        typeof window === 'undefined' ? undefined : window.sessionStorage,
        legacyDraftOwner,
      )
    } catch {
      return createDraftStore(context)
    }
  })
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
