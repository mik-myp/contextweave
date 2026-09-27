import { createEnvironmentCommandClient } from '@/features/environments/commands/command-client'
import { useEffect, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { workspaceContextSchema, type WorkspaceContext } from '@contextweave/contracts'
import { createWorkspaceApi } from './workspace-api'
import { WorkspaceSessionContext, workspaceKey } from './workspace-session-context'

export function WorkspaceSessionProvider({
  context,
  legacyDraftOwner,
  children,
}: {
  context: WorkspaceContext
  legacyDraftOwner?: string
  children: ReactNode
}) {
  const owner = workspaceContextSchema.parse(context)
  // Remount the entire session subtree, not merely its query functions.
  return (
    <Session key={owner.workspaceId} context={owner} legacyDraftOwner={legacyDraftOwner}>
      {children}
    </Session>
  )
}
function Session({
  context,
  legacyDraftOwner,
  children,
}: {
  context: WorkspaceContext
  legacyDraftOwner?: string
  children: ReactNode
}) {
  const client = useQueryClient()
  const [session] = useState(() => {
    const api = createWorkspaceApi(context)
    let storage: Storage | undefined
    try {
      storage = window.localStorage
    } catch {
      /* Client remains read-only if tracking is unavailable. */
    }
    return {
      context: Object.freeze({ ...context }),
      api,
      legacyDraftOwner,
      commands: createEnvironmentCommandClient({ context, api: api.environment, storage }),
    }
  })
  useEffect(() => {
    const unsubscribe = window.contextweave.events.onDataChanged(session.context, (domains) => {
      for (const domain of domains)
        void client.invalidateQueries({ queryKey: workspaceKey(session.context, domain) })
    })
    const reconcile = () => {
      void client.invalidateQueries({
        queryKey: workspaceKey(session.context),
        refetchType: 'active',
      })
    }
    // Reconcile on entry as well as focus: events while another scope was mounted
    // are intentionally ignored, so its retained cache must not be treated as fresh.
    reconcile()
    window.addEventListener('focus', reconcile)
    return () => {
      session.commands.stopObserving()
      unsubscribe()
      window.removeEventListener('focus', reconcile)
      void client.cancelQueries({ queryKey: workspaceKey(session.context) })
    }
  }, [client, session])
  return (
    <WorkspaceSessionContext.Provider value={session}>{children}</WorkspaceSessionContext.Provider>
  )
}
