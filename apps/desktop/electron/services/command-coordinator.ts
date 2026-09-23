import { randomUUID } from 'node:crypto'
import type { IpcResult, OperationKind } from '@contextweave/contracts'
import type { EnvironmentRepository } from '@contextweave/storage'
import { fail } from './result'

export function createCommandCoordinator(repository: EnvironmentRepository, changed: () => void) {
  const pending = new Map<string, Promise<unknown>>()
  return {
    drain: () => Promise.allSettled([...pending.values()]),
    busy: (id: string) => pending.has(id),
    settled: (id: string) => pending.get(id),
    async run<T>(
      kind: OperationKind,
      id: string | null,
      execute: (phase: (value: string) => void) => Promise<IpcResult<T>> | IpcResult<T>,
    ): Promise<IpcResult<T>> {
      if (id && pending.has(id)) return fail('OPERATION_IN_PROGRESS')
      const operationId = `operation-${randomUUID()}`
      repository.createOperation(operationId, kind, id)
      // Start after reserving the key so synchronous and asynchronous commands share one guard.
      const operation = Promise.resolve().then(async () => {
        try {
          const result = await execute((phase) => {
            repository.updateOperation(operationId, phase)
            changed()
          })
          repository.updateOperation(
            operationId,
            'completed',
            result.ok ? 'succeeded' : result.code === 'CANCELLED' ? 'cancelled' : 'failed',
            result.ok ? null : result.code,
          )
          return result
        } catch (error) {
          const code =
            error instanceof Error && /^[A-Z][A-Z_]+$/.test(error.message)
              ? error.message
              : 'COMMAND_FAILED'
          repository.updateOperation(
            operationId,
            'failed',
            code === 'CANCELLED' ? 'cancelled' : 'failed',
            code,
          )
          return fail(code)
        } finally {
          pending.delete(id ?? operationId)
          changed()
        }
      })
      pending.set(id ?? operationId, operation)
      changed()
      return operation
    },
  }
}
