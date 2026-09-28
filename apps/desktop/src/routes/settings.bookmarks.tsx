import { createFileRoute, redirect } from '@tanstack/react-router'

// Preserve links from older builds without keeping a duplicate settings page.
export const Route = createFileRoute('/settings/bookmarks')({
  beforeLoad: () => {
    throw redirect({ to: '/bookmarks', replace: true })
  },
})
