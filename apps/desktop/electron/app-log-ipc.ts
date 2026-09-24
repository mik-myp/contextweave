import { z } from 'zod'
import { appLogEntrySchema } from '@contextweave/contracts'
import type { createAppLogService } from './services/app-log-service'
import { ok, fail } from './services/result'

export function createAppLogHandlers(
  logs: ReturnType<typeof createAppLogService>,
  writeClipboard: (text: string) => void,
) {
  return {
    'logs:list': (input: unknown) =>
      z.undefined().safeParse(input).success ? ok(logs.snapshot()) : fail('INVALID_INPUT'),
    'logs:copy': (input: unknown) => {
      const parsed = appLogEntrySchema.shape.id.safeParse(input)
      if (!parsed.success) return fail('INVALID_INPUT')
      const entry = logs.snapshot().entries.find((item) => item.id === parsed.data)
      if (!entry) return fail('NOT_FOUND')
      try {
        writeClipboard(JSON.stringify(entry, null, 2))
        return ok(true)
      } catch {
        return fail('COMMAND_FAILED')
      }
    },
    'logs:clear': (input: unknown) =>
      z.undefined().safeParse(input).success ? ok(logs.clear()) : fail('INVALID_INPUT'),
  }
}
