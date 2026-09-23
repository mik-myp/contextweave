import { createFileRoute, redirect } from '@tanstack/react-router'
export const Route = createFileRoute('/about')({
  beforeLoad: () => {
    throw redirect({ to: '/settings/about', replace: true })
  },
})
