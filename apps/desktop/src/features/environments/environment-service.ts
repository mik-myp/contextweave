import type { WorkspaceApi } from '@/features/workspaces/workspace-api'
import { useWorkspaceSession } from '@/features/workspaces/workspace-session-context'
import { useMemo } from 'react'
import type { IpLocaleRequest, EnvironmentCommandKind } from '@contextweave/contracts'
import {
  toCreateEnvironmentInput,
  toUpdateEnvironmentInput,
  type EnvironmentFormValues,
} from './environment-form'
import { unwrapIpc as unwrap } from '@/shared/lib/ipc'
import { errorMessage } from '@/shared/lib/error-message'
import type { EnvironmentCommandClient, NewEnvironmentCommand } from './commands/command-client'

export function createEnvironmentService(
  workspaceApi: WorkspaceApi,
  commands: EnvironmentCommandClient,
) {
  const perform = (intent: NewEnvironmentCommand) =>
    commands.execute(intent, (receipt) =>
      unwrap(workspaceApi.environment.get(receipt.environmentId)),
    )
  const action = (
    kind: Exclude<EnvironmentCommandKind, 'create' | 'update'>,
    environmentId: string,
    expectedRevision: number | undefined,
  ) => {
    if (expectedRevision === undefined)
      return Promise.reject(new Error(errorMessage('CONFIG_CONFLICT')))
    return perform({ kind, environmentId, expectedRevision })
  }
  return {
    detectLocale: (input: IpLocaleRequest) => unwrap(workspaceApi.environment.detectLocale(input)),
    cancelLocale: (requestId: string) => unwrap(workspaceApi.environment.cancelLocale(requestId)),
    delete: (environmentId: string, expectedRevision: number) =>
      commands.execute({ kind: 'trash', environmentId, expectedRevision }),
    restore: (id: string, revision: number) => action('restore', id, revision),
    get: (id: string) => unwrap(workspaceApi.environment.get(id)),
    save: (values: EnvironmentFormValues, id?: string, expectedRevision?: number) => {
      if (id) {
        if (expectedRevision === undefined)
          return Promise.reject(new Error(errorMessage('CONFIG_CONFLICT')))
        return perform({
          kind: 'update',
          input: { ...toUpdateEnvironmentInput(id, values), expectedRevision },
        })
      }
      return perform({ kind: 'create', input: toCreateEnvironmentInput(values) })
    },
    start: (id: string, revision: number | undefined) => action('start', id, revision),
    stop: (id: string, revision: number | undefined) => action('stop', id, revision),
    recover: (id: string, revision: number) => action('recover', id, revision),
  }
}
export function useEnvironmentService() {
  const { api, commands } = useWorkspaceSession()
  return useMemo(() => createEnvironmentService(api, commands), [api, commands])
}
export function isEnvironmentReadOnly(status: string) {
  return ['running', 'starting', 'stopping', 'needs-recovery'].includes(status)
}
