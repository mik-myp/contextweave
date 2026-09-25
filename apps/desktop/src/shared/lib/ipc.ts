import { errorMessage } from './error-message'
import type { IpcResult } from '@contextweave/contracts'

export async function unwrapIpc<T>(request: Promise<IpcResult<T>>): Promise<T> {
  let result: IpcResult<T>
  try {
    result = await request
  } catch {
    throw new Error(errorMessage('IPC_UNAVAILABLE'))
  }
  if (!result.ok) throw new Error(errorMessage(result.code))
  return result.data
}
