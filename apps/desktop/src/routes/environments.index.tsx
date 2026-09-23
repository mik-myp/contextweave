import { createFileRoute } from '@tanstack/react-router'
import { EnvironmentsPage } from '@/features/environments/pages/environments-page'
export const Route = createFileRoute('/environments/')({ component: EnvironmentsPage })
