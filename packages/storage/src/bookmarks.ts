import {
  assertWorkspaceContext,
  defaultBookmarksSchema,
  environmentIdSchema,
  saveDefaultBookmarksSchema,
  type DefaultBookmarks,
} from '@contextweave/contracts'
import type { EnvironmentRepository } from './index'

const templateKey = 'bookmarks:defaults:v1'
type ProfileState = 'eligible' | 'pending' | 'complete' | 'retry'

/** Uses the existing workspace-owned app_settings table; no database schema change. */
export class BookmarkSettingsRepository {
  constructor(private readonly repository: EnvironmentRepository) {}

  get(): DefaultBookmarks {
    try {
      const stored = this.repository.getSetting<unknown>(templateKey)
      const value = defaultBookmarksSchema.parse(
        stored === undefined
          ? {
              workspaceId: this.repository.workspaceId,
              revision: 0,
              items: [],
            }
          : stored,
      )
      assertWorkspaceContext(this.repository.context, { workspaceId: value.workspaceId })
      return value
    } catch {
      throw new Error('BOOKMARKS_SETTINGS_INVALID')
    }
  }

  save(input: unknown): DefaultBookmarks {
    const parsed = saveDefaultBookmarksSchema.parse(input)
    const current = this.get()
    if (current.revision !== parsed.expectedRevision) throw new Error('BOOKMARKS_CONFLICT')
    const next = defaultBookmarksSchema.parse({
      workspaceId: this.repository.workspaceId,
      revision: current.revision + 1,
      items: parsed.items,
    })
    // Synchronous comparison/write is serialized by the controlled Main service.
    this.repository.setSetting(templateKey, next)
    return next
  }

  profileState(environmentId: string): ProfileState | undefined {
    try {
      const value = this.repository.getSetting<unknown>(this.profileKey(environmentId))
      if (
        value === undefined ||
        value === 'eligible' ||
        value === 'pending' ||
        value === 'complete' ||
        value === 'retry'
      )
        return value
    } catch {
      // Malformed persisted JSON is also an ambiguous initialization decision.
    }
    throw new Error('BOOKMARKS_PROFILE_RECOVERY_REQUIRED')
  }

  setProfileState(environmentId: string, state: ProfileState): void {
    this.repository.setSetting(this.profileKey(environmentId), state)
  }

  private profileKey(environmentId: string): string {
    return `bookmarks:profile:v1:${environmentIdSchema.parse(environmentId)}`
  }
}
