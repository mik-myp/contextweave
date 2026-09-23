import { errorMessage } from './error-message'
import type { IpcResult } from '@contextweave/contracts'

export async function unwrapIpc<T>(request: Promise<IpcResult<T>>): Promise<T> {
  const result = await request
  if (!result.ok) throw new Error(errorMessage(result.code, result.message))
  return result.data
}
