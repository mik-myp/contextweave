import { createFileRoute } from '@tanstack/react-router'
import { EnvironmentEditPage } from '@/features/environments/pages/environment-edit-page'

export const Route = createFileRoute('/environments/$environmentId/edit')({
  component: EnvironmentEditPage,
})
