import type { bookmarkMessages as zh } from './zh-CN-bookmarks'

export const bookmarkMessages: Record<keyof typeof zh, string> = {
  'bookmarks.title': 'Default bookmarks',
  'bookmarks.description':
    'Manage the bookmark template for new browser profiles in this workspace.',
  'bookmarks.scopeHelp':
    'Bookmarks are added to the bookmarks bar in this order only before the first launch of a confirmed uninitialized profile. Existing profiles, including cloned and imported data, are left unchanged. Saving does not update previously launched profiles, open websites or change startup pages.',
  'bookmarks.add': 'Add bookmark',
  'bookmarks.edit': 'Edit bookmark',
  'bookmarks.delete': 'Delete bookmark',
  'bookmarks.up': 'Move up',
  'bookmarks.down': 'Move down',
  'bookmarks.name': 'Name',
  'bookmarks.url': 'URL',
  'bookmarks.urlHelp':
    'Use an HTTP(S) URL without a username, password, spaces or control characters.',
  'bookmarks.invalidName': 'Enter a name of 1–120 characters.',
  'bookmarks.apply': 'Apply to list',
  'bookmarks.empty': 'No default bookmarks',
  'bookmarks.emptyHelp':
    'The list starts empty. Add bookmarks, or leave it empty to add none to new profiles.',
  'bookmarks.save': 'Save template',
  'bookmarks.saving': 'Saving…',
  'bookmarks.saved':
    'Template saved. Only profiles initialized for the first time from now on are affected.',
  'bookmarks.unsaved': 'List changes have not been saved.',
  'bookmarks.reset': 'Discard changes',
  'bookmarks.conflict':
    'The template changed elsewhere. Note your edits, then discard changes and edit again.',
  'bookmarks.deleteConfirm': 'Remove from the default bookmark list?',
  'bookmarks.deleteHelp':
    'Takes effect when you save the template. Bookmarks in existing browser profiles are not deleted.',
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
