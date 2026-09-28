import type { commandMessages as zh } from './zh-CN-commands'
export const commandMessages: Record<keyof typeof zh, string> = {
  'commands.details': 'Diagnostic details',
  'commands.title': 'Command receipts',
  'commands.help':
    'Receipts survive navigation and restart. Starts run sequentially without limiting running browsers. Unknown outcomes are never retried automatically.',
  'commands.pendingTitle': 'Requests awaiting verification',
  'commands.pendingHelp':
    'Original request IDs are retained. Verify before another attempt. Closing this page does not stop tasks already accepted by Main.',
  'commands.none': 'No command receipts yet',
  'commands.requestId': 'Request ID',
  'commands.target': 'Environment',
  'commands.created': 'Submitted',
  'commands.check': 'Verify original request',
  'commands.acknowledge': 'End local tracking',
  'commands.ackTitle': 'Confirm the original request was inspected',
  'commands.ackHelp':
    'This only clears the local tracking notice. It does not cancel work, delete the authoritative receipt or establish success. An absent receipt may still arrive later. Inspect environments, browsers and data manually; do not repeat creation or execution.',
  'commands.notFound':
    'No receipt was found yet. This does not prove that the request never executed. The original ID is retained; no automatic retry will occur.',
  'commands.cancelQueued': 'Cancel queued command',
  'commands.cancelHelp':
    'Only unstarted commands can be cancelled. Completed effects are not rolled back.',
  'commands.previous': 'Previous page',
  'commands.next': 'Next page',
  'commands.queued': 'Queued',
  'commands.running': 'Running',
  'commands.succeeded': 'Succeeded',
  'commands.failed': 'Confirmed failure',
  'commands.cancelled': 'Cancelled',
  'commands.unknown': 'Unknown; inspect outcome',
  'commands.trackingProblem':
    'Local request tracking is unavailable; new submissions are blocked. Authoritative receipts remain in the workspace database.',
  'commands.resetTracking': 'Reset local index after manual inspection',
  'commands.resetTitle': 'Reset the unreadable local index?',
  'commands.recoveryTitle': 'Inspect and recover runtime state',
  'commands.recoveryHelp':
    'Inspect the browser and data before confirming. Recovery only changes management state: it does not restore pages, delete data, or kill/adopt a process by its old PID. Revision, process identity and locks are checked again when executed.',
  'commands.recoveryConfirm': 'Inspected; recover management state',
  'commands.lock': 'Profile lock',
  'commands.lock.absent': 'No lock',
  'commands.lock.stale': 'Leftover lock; inspect first',
  'commands.lock.live': 'A process may still own the lock',
  'commands.lock.unreadable': 'Ownership unreadable; manual action required',
  'commands.sessions': 'Possibly live recorded sessions: {live} / {total}',
  'commands.unconfirmed':
    'Some command outcomes remain unconfirmed. Recovery does not change their original receipts to success.',
  'commands.busy':
    'This environment has queued or running commands. Configuration is temporarily read-only.',
  'commands.trashScope':
    'Workspace: {workspace}; {count} environments in trash. Configuration, credential references, history and browser data remain and may be the only copy. Restoring from trash is not backup recovery.',
  'commands.orphanScope':
    'Workspace: {workspace}; {count} unlinked directories. Missing database records do not make directories unused or safe to delete. Browser data may be the only copy. No deletion or automatic recovery is performed here.',
  'error.COMMAND_UNCONFIRMED':
    'The original request ID is retained and its outcome is unconfirmed. Verify its receipt instead of submitting again.',
  'error.COMMAND_TRACKING_UNAVAILABLE':
    'The local request index could not be read or saved; further submissions are blocked. Previously submitted requests may have executed. Inspect authoritative receipts and restore local storage before continuing.',
  'error.COMMAND_TRACKING_LIMIT':
    'Too many requests await verification. Inspect completed requests and end their local tracking first.',
  'error.COMMAND_LOOKUP_REQUIRED':
    'Look up the original request before acknowledging its local tracking.',
  'error.COMMAND_INTENT_CONFLICT':
    'This request ID belongs to a different intent. The original operation was not replayed.',
  'error.COMMAND_RESULT_UNKNOWN':
    'Completion is uncertain. Inspect the actual environment and data before attempting again.',
  'error.COMMAND_STORAGE_FAILED':
    'Persistence failed and new effects were stopped. Outcomes may be unknown. Preserve data and inspect again after restoring storage.',
  'error.COMMAND_INTERRUPTED':
    'The app was interrupted. This command was not replayed; inspect its original outcome.',
  'error.COMMAND_QUEUE_FULL':
    'The command queue is full. Wait or cancel commands that have not started.',
  'error.COMMAND_CURSOR_INVALID': 'This receipt cursor is unavailable. Return to the first page.',
  'error.COMMAND_RECEIPT_MISMATCH':
    'The returned receipt does not belong to the original request and cannot establish success.',
}
