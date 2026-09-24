import type { AppUpdateState } from '@contextweave/contracts'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useI18n } from '@/i18n'
import { unwrapIpc } from '@/shared/lib/ipc'
import { errorMessage } from '@/shared/lib/error-message'

const updateKey = ['local', 'app-update'] as const
type UpdateCommand = 'check' | 'download' | 'cancel' | 'openInstaller'

export function useAppUpdate() {
  const { t } = useI18n()
  const client = useQueryClient()
  const [linkError, setLinkError] = useState<string>()
  const query = useQuery({
    queryKey: updateKey,
    queryFn: () => unwrapIpc(window.contextweave.update.getState()),
    refetchInterval: (query) =>
      ['checking', 'downloading'].includes(query.state.data?.phase ?? '') ? 500 : false,
  })
  const command = useMutation({
    mutationFn: (action: UpdateCommand) => unwrapIpc(window.contextweave.update[action]()),
    onMutate: async (action) => {
      await client.cancelQueries({ queryKey: updateKey })
      setLinkError(undefined)
      const current = client.getQueryData<AppUpdateState>(updateKey)
      if (current && (action === 'check' || action === 'download')) {
        client.setQueryData(updateKey, {
          ...current,
          phase: action === 'check' ? 'checking' : 'downloading',
          errorCode: undefined,
          ...(action === 'check'
            ? { release: undefined }
            : { receivedBytes: 0, totalBytes: current.release?.asset?.sizeBytes ?? 0 }),
        })
      }
    },
    onSuccess: (state) => client.setQueryData(updateKey, state),
    onError: () => void client.invalidateQueries({ queryKey: updateKey }),
  })
  const state = query.data
  const error = state?.errorCode
    ? errorMessage(state.errorCode)
    : (command.error?.message ?? query.error?.message ?? linkError)
  const openRelease = async () => {
    try {
      await unwrapIpc(window.contextweave.update.openRelease())
      setLinkError(undefined)
    } catch (cause) {
      setLinkError(cause instanceof Error ? cause.message : t('admin.operationError'))
    }
  }
  return { state, command, loading: query.isPending, error, openRelease }
}
