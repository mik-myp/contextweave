import type { bookmarkMessages as zh } from './zh-CN-bookmarks'

export const bookmarkMessages: Record<keyof typeof zh, string> = {
  'bookmarks.openOnStart': 'Open on startup',
  'bookmarks.drag': 'Drag to reorder',
  'bookmarks.dragHelp':
    'Press Space to pick up, arrow keys to move, Space to drop, Escape to cancel.',
  'bookmarks.dragging': 'Bookmark picked up',
  'bookmarks.dragPosition': 'Move to position {position}',
  'bookmarks.dragged': 'Order updated; save to apply',
  'bookmarks.dragCancelled': 'Reordering cancelled',
  'bookmarks.undoDelete': 'Undo removal',
  'error.BOOKMARKS_STARTUP_FAILED':
    'Startup bookmarks could not be opened. Check the browser and bookmark settings, then retry.',
  'bookmarks.list': 'Bookmark list',
  'bookmarks.title': 'Bookmarks',
  'bookmarks.add': 'Add bookmark',
  'bookmarks.delete': 'Delete bookmark',
  'bookmarks.name': 'Name',
  'bookmarks.url': 'URL',
  'bookmarks.urlHelp':
    'Use an HTTP(S) URL without a username, password, spaces or control characters.',
  'bookmarks.invalidName': 'Enter a name of 1–120 characters.',
  'bookmarks.empty': 'No bookmarks yet',
  'bookmarks.emptyHelp': 'Add a bookmark and choose whether to open it when an environment starts.',
  'bookmarks.save': 'Save changes',
  'bookmarks.saving': 'Saving…',
  'bookmarks.saved':
    'Bookmarks saved. Startup choices apply the next time you start an environment.',
  'bookmarks.unsaved': 'List changes have not been saved.',
  'bookmarks.reset': 'Discard changes',
  'bookmarks.conflict':
    'Bookmarks changed elsewhere. Note your edits, then discard changes and edit again.',
  'error.BOOKMARKS_CONFLICT':
    'Default bookmarks changed elsewhere. Your edits are kept; reload the template before editing again.',
  'error.BOOKMARKS_SETTINGS_INVALID':
    'Default bookmark settings could not be read. Original data was not overwritten. Check the workspace data or restore a backup.',
  'error.BOOKMARKS_PROFILE_UNSAFE':
    'The profile path contains a link or unsafe directory. Default bookmarks were not written. Check the profile directory.',
  'error.BOOKMARKS_PROFILE_CHANGED':
    'The profile changed during initialization. Launch was stopped. Ensure no other program is changing this profile before retrying.',
  'error.BOOKMARKS_PROFILE_IO_FAILED':
    'Default bookmark initialization failed and its file changes were rolled back. Check disk space and directory permissions, then retry launch.',
  'error.BOOKMARKS_PROFILE_LOCK_REQUIRED':
    'An exclusive runtime lock is required before writing default bookmarks.',
  'error.BOOKMARKS_PROFILE_RECOVERY_REQUIRED':
    'Bookmark initialization was interrupted or could not be safely rolled back. Launch was stopped to protect the profile. Back up and inspect the profile and initialization record; do not overwrite existing files.',
}
