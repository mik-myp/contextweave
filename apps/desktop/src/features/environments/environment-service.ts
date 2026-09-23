import {
  toCreateEnvironmentInput,
  toUpdateEnvironmentInput,
  type EnvironmentFormValues,
} from './environment-form'

import { unwrapIpc as unwrap } from '@/shared/lib/ipc'

export const environmentService = {
  delete: (id: string) => unwrap(window.contextweave.environment.delete(id)),
  get: (id: string) => unwrap(window.contextweave.environment.get(id)),
  save: (values: EnvironmentFormValues, id?: string, expectedRevision?: number) =>
    id
      ? unwrap(
          window.contextweave.environment.update({
            ...toUpdateEnvironmentInput(id, values),
            expectedRevision,
          }),
        )
      : unwrap(window.contextweave.environment.create(toCreateEnvironmentInput(values))),
  start: (id: string) => unwrap(window.contextweave.environment.start(id)),
  stop: (id: string) => unwrap(window.contextweave.environment.stop(id)),
  recover: (id: string) => unwrap(window.contextweave.environment.recover(id)),
}

export function isEnvironmentReadOnly(status: string) {
  return ['running', 'starting', 'stopping', 'needs-recovery'].includes(status)
}
