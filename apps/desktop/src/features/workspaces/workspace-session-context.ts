import type { EnvironmentCommandClient } from '@/features/environments/commands/command-client'
import { createContext, useContext } from 'react'
import { workspaceContextSchema, type WorkspaceContext } from '@contextweave/contracts'
import type { WorkspaceApi } from './workspace-api'

export function workspaceKey(context: WorkspaceContext, ...parts: readonly unknown[]) {
  return ['workspace', workspaceContextSchema.parse(context).workspaceId, ...parts] as const
}
export type WorkspaceSession = {
  context: Readonly<WorkspaceContext>
  commands: EnvironmentCommandClient
  api: WorkspaceApi
  /** Only the verified original default identity may claim ownerless pre-v2 drafts. */
  legacyDraftOwner?: string
}
export const WorkspaceSessionContext = createContext<WorkspaceSession | null>(null)
export function useWorkspaceSession() {
  const session = useContext(WorkspaceSessionContext)
  if (!session) throw new Error('WorkspaceSessionProvider is required')
  return session
}
export const useWorkspaceApi = () => useWorkspaceSession().api
export const useWorkspaceContext = () => useWorkspaceSession().context
