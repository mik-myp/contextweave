import { createFileRoute } from '@tanstack/react-router'
import { SettingsUpdatesPage } from '@/features/settings/pages/settings-updates-page'
export const Route = createFileRoute('/settings/updates')({ component: SettingsUpdatesPage })
