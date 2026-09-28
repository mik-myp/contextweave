import { createFileRoute } from '@tanstack/react-router'
import { SettingsBookmarksPage } from '@/features/bookmarks/pages/settings-bookmarks-page'

export const Route = createFileRoute('/settings/bookmarks')({ component: SettingsBookmarksPage })
