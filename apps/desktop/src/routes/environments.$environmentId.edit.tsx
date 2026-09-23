import { createFileRoute } from '@tanstack/react-router'
import { EnvironmentConfigPage } from '@/features/environments/pages/environment-config-page'
export const Route = createFileRoute('/environments/$environmentId/edit')({
  component: EditEnvironmentRoute,
})
function EditEnvironmentRoute() {
  const { environmentId } = Route.useParams()
  return <EnvironmentConfigPage environmentId={environmentId} />
}
