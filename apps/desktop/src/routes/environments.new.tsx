import { createFileRoute } from '@tanstack/react-router'
import { EnvironmentConfigPage } from '@/features/environments/pages/environment-config-page'
export const Route = createFileRoute('/environments/new')({ component: EnvironmentConfigPage })
