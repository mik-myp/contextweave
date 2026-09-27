import { useParams } from '@tanstack/react-router'
import { EnvironmentConfigPage } from './environment-config-page'

export function EnvironmentEditPage() {
  const { environmentId } = useParams({ from: '/environments/$environmentId/edit' })
  return <EnvironmentConfigPage environmentId={environmentId} />
}
