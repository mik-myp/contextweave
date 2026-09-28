import { ZodError } from 'zod'
import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useWorkspaceSession, workspaceKey } from '@/features/workspaces/workspace-session-context'
import { unwrapIpc } from '@/shared/lib/ipc'
import { errorMessage } from '@/shared/lib/error-message'
import {
  organizationNameKey,
  type EnvironmentSummary,
  type IpcResult,
  type OrganizationSnapshot,
} from '@contextweave/contracts'

export type OrganizedEnvironment = EnvironmentSummary & {
  groupId: string | null
  groupName: string
  tags: string[]
  note: string
  organizationRevision: number
}
export function organizeEnvironments(
  environments: EnvironmentSummary[],
  snapshot?: OrganizationSnapshot,
): OrganizedEnvironment[] {
  const annotations = new Map(snapshot?.environments.map((item) => [item.environmentId, item]))
  const groups = new Map(snapshot?.groups.map((item) => [item.id, item.name]))
  const tags = new Map(snapshot?.tags.map((item) => [organizationNameKey(item.name), item.name]))
  return environments.map((environment) => {
    const annotation = annotations.get(environment.id)
    return {
      ...environment,
      groupId: annotation?.groupId ?? null,
      groupName: groups.get(annotation?.groupId ?? '') ?? '',
      tags: (annotation?.tags ?? []).map((name) => tags.get(organizationNameKey(name)) ?? name),
      note: annotation?.note ?? '',
      organizationRevision: annotation?.revision ?? 0,
    }
  })
}
export function useOrganization() {
  const { context, api } = useWorkspaceSession()
  return useQuery({
    queryKey: workspaceKey(context, 'organization'),
    queryFn: async ({ signal }) => {
      signal.throwIfAborted()
      const value = await unwrapIpc(api.organization.list())
      signal.throwIfAborted()
      return value
    },
  })
}
export function useOrganizationCommand() {
  const { context } = useWorkspaceSession(),
    client = useQueryClient()
  const [pending, setPending] = useState(false),
    [error, setError] = useState<string>()
  const busy = useRef(false),
    mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  return {
    pending,
    error,
    clearError: () => setError(undefined),
    async run<T>(action: () => Promise<IpcResult<T>>, onSuccess?: (value: T) => void) {
      if (busy.current) return
      busy.current = true
      setPending(true)
      setError(undefined)
      try {
        const result = await unwrapIpc(action())
        await client.invalidateQueries({ queryKey: workspaceKey(context, 'organization') })
        if (mounted.current) onSuccess?.(result)
      } catch (cause) {
        if (mounted.current)
          setError(
            cause instanceof ZodError
              ? errorMessage('INVALID_INPUT')
              : cause instanceof Error
                ? cause.message
                : errorMessage('COMMAND_FAILED'),
          )
      } finally {
        busy.current = false
        if (mounted.current) setPending(false)
      }
    },
  }
}
