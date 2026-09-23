import type { IpcResult } from '@contextweave/contracts'
import {
  toCreateEnvironmentInput,
  toUpdateEnvironmentInput,
  type EnvironmentFormValues,
} from './environment-form'

async function unwrap<T>(request: Promise<IpcResult<T>>): Promise<T> {
  const result = await request
  if (!result.ok) throw new Error(result.message)
  return result.data
}

export const environmentService = {
  delete: (id: string) => unwrap(window.contextweave.environment.delete(id)),
  get: (id: string) => unwrap(window.contextweave.environment.get(id)),
  save: (values: EnvironmentFormValues, id?: string) =>
    id
      ? unwrap(window.contextweave.environment.update(toUpdateEnvironmentInput(id, values)))
      : unwrap(window.contextweave.environment.create(toCreateEnvironmentInput(values))),
  start: (id: string) => unwrap(window.contextweave.environment.start(id)),
  stop: (id: string) => unwrap(window.contextweave.environment.stop(id)),
  recover: (id: string) => unwrap(window.contextweave.environment.recover(id)),
}

export function isEnvironmentReadOnly(status: string) {
  return ['running', 'starting', 'stopping', 'needs-recovery'].includes(status)
}
