import { createFileRoute } from '@tanstack/react-router'
import { ProxiesPage } from '@/features/proxies/pages/proxies-page'

export const Route = createFileRoute('/proxies')({ component: ProxiesPage })
