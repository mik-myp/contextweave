import { createRootRoute } from '@tanstack/react-router'
import { AppShell } from '@/app/app-shell'
import { AppDataProvider } from '@/app/app-data-provider'

function RootRoute() {
  return (
    <AppDataProvider>
      <AppShell />
    </AppDataProvider>
  )
}

export const Route = createRootRoute({ component: RootRoute })
