import { TeamSwitcher } from '@/components/team-switcher'
import { useWorkspace } from '../hooks/use-workspace'

export function WorkspaceSwitcher() {
  const query = useWorkspace()
  return (
    <TeamSwitcher
      workspace={query.error ? undefined : query.data}
      isPending={query.isPending}
      isFetching={query.isFetching}
      hasError={Boolean(query.error)}
      onRetry={() => {
        void query.refetch()
      }}
    />
  )
}
