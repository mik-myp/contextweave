import { DataTableStateProvider } from '@/components/data-table/data-table-state-provider'
import { EnvironmentDraftProvider } from '@/features/environments/environment-draft-provider'
import { AppShell } from '@/app/app-shell'
import { AppDataProvider } from '@/app/app-data-provider'

export function RootLayout() {
  return (
    <AppDataProvider>
      <DataTableStateProvider>
        <EnvironmentDraftProvider>
          <AppShell />
        </EnvironmentDraftProvider>
      </DataTableStateProvider>
    </AppDataProvider>
  )
}
