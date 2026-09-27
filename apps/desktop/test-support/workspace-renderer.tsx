import { createEnvironmentCommandClient } from '../src/features/environments/commands/command-client'
import { useMemo, type ReactNode } from 'react'
import { type WorkspaceContext } from '@contextweave/contracts'
import { WorkspaceSessionContext } from '../src/features/workspaces/workspace-session-context'
import { createWorkspaceApi } from '../src/features/workspaces/workspace-api'
import { fixtureWorkspace } from './workspace'

/** Explicit feature-test boundary. Production event/remount behavior is tested separately. */
export function TestWorkspaceProvider({
  children,
  context = fixtureWorkspace,
}: {
  children: ReactNode
  context?: WorkspaceContext
}) {
  const value = useMemo(() => {
    const api = createWorkspaceApi(context)
    return {
      context,
      api,
      commands: createEnvironmentCommandClient({
        context,
        api: api.environment,
        storage: window.localStorage,
      }),
    }
  }, [context])
  return (
    <WorkspaceSessionContext.Provider value={value}>{children}</WorkspaceSessionContext.Provider>
  )
}
