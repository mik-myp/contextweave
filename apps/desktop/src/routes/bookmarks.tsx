import { createFileRoute } from '@tanstack/react-router'
import { BookmarksPage } from '@/features/bookmarks/pages/bookmarks-page'

export const Route = createFileRoute('/bookmarks')({ component: BookmarksPage })
