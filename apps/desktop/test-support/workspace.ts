import { assertWorkspaceContext, type WorkspaceContext } from '@contextweave/contracts'
import type { createApplication } from '../electron/application'

export const fixtureWorkspace = { workspaceId: '00000000-0000-4000-8000-000000000001' }

/** Explicit trusted caller used by existing payload tests; raw IPC has separate refusal tests. */
export function scopedCommands(
  app: ReturnType<typeof createApplication>,
  context: WorkspaceContext,
) {
  return {
    ...app,
    invoke(channel: string, payload?: unknown) {
      return app.invoke(
        channel,
        ['workspace:current', 'settings:get-theme', 'settings:set-theme'].includes(channel)
          ? payload
          : { ...context, payload },
      )
    },
  }
}

/** Keep feature-behavior mocks small, but fail if the client omits or forges context. */
export function withWorkspaceFixture(groups: Record<string, Record<string, unknown>>) {
  return {
    workspace: {
      current: async () => ({
        ok: true,
        data: {
          ...fixtureWorkspace,
          kind: 'personal',
          storageMode: 'local',
          createdAt: '2026-09-27T00:00:00.000Z',
        },
      }),
    },
    ...Object.fromEntries(
      Object.entries(groups).map(([group, methods]) => [
        group,
        Object.fromEntries(
          Object.entries(methods).map(([name, method]) => [
            name,
            typeof method !== 'function'
              ? method
              : (context: unknown, ...args: unknown[]) => {
                  assertWorkspaceContext(fixtureWorkspace, context)
                  return Reflect.apply(method, undefined, args)
                },
          ]),
        ),
      ]),
    ),
  }
}
