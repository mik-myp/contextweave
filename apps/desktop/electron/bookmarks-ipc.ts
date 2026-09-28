import { defaultBookmarksSchema } from '@contextweave/contracts'
import type { BookmarkSettingsRepository } from '@contextweave/storage'
import { z } from 'zod'
import { ok } from './services/result'

// Sender/active-workspace checks are supplied by the application's existing dispatcher.
export function createBookmarkHandlers(
  repository: BookmarkSettingsRepository,
  changed: () => void,
) {
  return {
    'bookmarks:get': (input?: unknown) => {
      z.undefined().parse(input)
      return ok(defaultBookmarksSchema.parse(repository.get()))
    },
    'bookmarks:save': (input?: unknown) => {
      const result = defaultBookmarksSchema.parse(repository.save(input))
      changed()
      return ok(result)
    },
  }
}
