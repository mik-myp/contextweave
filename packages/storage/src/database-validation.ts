import type { DatabaseSync } from 'node:sqlite'
import { verifyDatabaseRelations } from './integrity'
import { verifyWorkspaceScope } from './workspace-scope'
import { verifyOrganizationStorage } from './organization'
import { verifyBatchStorage } from './batches'
import { verifyCommandStorage } from './commands'
import { verifyTagStorage } from './tags'

/** No writes: caller owns a consistent read transaction or the pending migration transaction. */
export function verifyLocalDatabase(sqlite: DatabaseSync): void {
  verifyDatabaseRelations(sqlite)
  verifyWorkspaceScope(sqlite)
  verifyOrganizationStorage(sqlite)
  verifyTagStorage(sqlite)
  verifyBatchStorage(sqlite)
  verifyCommandStorage(sqlite)
}
