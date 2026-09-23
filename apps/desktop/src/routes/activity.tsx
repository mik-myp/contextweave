import { createFileRoute } from '@tanstack/react-router'
import { ActivityPage } from '@/features/activity/pages/activity-page'

export const Route = createFileRoute('/activity')({ component: ActivityPage })
