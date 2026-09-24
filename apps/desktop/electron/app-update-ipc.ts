import { z } from 'zod'
import { appUpdateStateSchema } from '@contextweave/contracts'
import type { createAppUpdateService } from './services/app-update-service'
import { ok, fail } from './services/result'

export function createAppUpdateHandlers(service: ReturnType<typeof createAppUpdateService>) {
  const stateAction =
    (action: () => ReturnType<typeof service.getState> | ReturnType<typeof service.check>) =>
    async (input: unknown) => {
      if (!z.undefined().safeParse(input).success) return fail('INVALID_INPUT')
      try {
        return ok(appUpdateStateSchema.parse(await action()))
      } catch (cause) {
        return fail(
          cause instanceof Error && /^[A-Z][A-Z_]+$/.test(cause.message)
            ? cause.message
            : 'UPDATE_FAILED',
        )
      }
    }
  return {
    'update:state': stateAction(service.getState),
    'update:check': stateAction(service.check),
    'update:download': stateAction(service.download),
    'update:install': stateAction(service.install),
    'update:cancel': stateAction(service.cancel),
    'update:open-installer': stateAction(service.openInstaller),
    'update:open-release': async (input: unknown) => {
      if (!z.undefined().safeParse(input).success) return fail('INVALID_INPUT')
      try {
        return ok(await service.openRelease())
      } catch {
        return fail('UPDATE_OPEN_FAILED')
      }
    },
  }
}
