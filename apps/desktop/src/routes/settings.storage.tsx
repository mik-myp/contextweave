import { createFileRoute } from '@tanstack/react-router'
import { SettingsStoragePage } from '@/features/settings/pages/settings-storage-page'

export const Route = createFileRoute('/settings/storage')({ component: SettingsStoragePage })
