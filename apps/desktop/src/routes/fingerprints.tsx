import { createFileRoute, redirect } from '@tanstack/react-router'
export const Route = createFileRoute('/fingerprints')({
  beforeLoad: () => {
    throw redirect({ to: '/kernels' })
  },
})
