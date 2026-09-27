import { workspaceApi } from '@/features/workspaces/workspace-api'
import type { IpLocaleRequest } from '@contextweave/contracts'
import {
  toCreateEnvironmentInput,
  toUpdateEnvironmentInput,
  type EnvironmentFormValues,
} from './environment-form'

import { unwrapIpc as unwrap } from '@/shared/lib/ipc'

export const environmentService = {
  detectLocale: (input: IpLocaleRequest) => unwrap(workspaceApi.environment.detectLocale(input)),
  cancelLocale: (requestId: string) => unwrap(workspaceApi.environment.cancelLocale(requestId)),
  delete: (id: string) => unwrap(workspaceApi.environment.delete(id)),
  get: (id: string) => unwrap(workspaceApi.environment.get(id)),
  save: (values: EnvironmentFormValues, id?: string, expectedRevision?: number) =>
    id
      ? unwrap(
          workspaceApi.environment.update({
            ...toUpdateEnvironmentInput(id, values),
            expectedRevision,
          }),
        )
      : unwrap(workspaceApi.environment.create(toCreateEnvironmentInput(values))),
  start: (id: string) => unwrap(workspaceApi.environment.start(id)),
  stop: (id: string) => unwrap(workspaceApi.environment.stop(id)),
  recover: (id: string) => unwrap(workspaceApi.environment.recover(id)),
}

export function isEnvironmentReadOnly(status: string) {
  return ['running', 'starting', 'stopping', 'needs-recovery'].includes(status)
}
