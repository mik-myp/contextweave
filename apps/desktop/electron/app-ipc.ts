import { z } from 'zod'
import {
  appInfoSchema,
  appPathKeySchema,
  appPathsSchema,
  externalUrlSchema,
  type AppInfo,
  type AppPaths,
} from '@contextweave/contracts'
import { ok, fail } from './services/result'

export function createAppHandlers(options: {
  getInfo(): AppInfo
  getPaths(): AppPaths
  copyText(text: string): void
  quit(): void
  openExternal(url: string): Promise<void>
}) {
  return {
    'app:get-info': (input: unknown) =>
      z.undefined().safeParse(input).success
        ? ok(appInfoSchema.parse(options.getInfo()))
        : fail('INVALID_INPUT'),
    'app:get-paths': (input: unknown) =>
      z.undefined().safeParse(input).success
        ? ok(appPathsSchema.parse(options.getPaths()))
        : fail('INVALID_INPUT'),
    'app:copy-path': (input: unknown) => {
      const parsed = appPathKeySchema.safeParse(input)
      if (!parsed.success) return fail('INVALID_INPUT')
      try {
        options.copyText(appPathsSchema.parse(options.getPaths())[parsed.data])
        return ok(true)
      } catch {
        return fail('COMMAND_FAILED')
      }
    },
    'app:quit': (input: unknown) => {
      if (!z.undefined().safeParse(input).success) return fail('INVALID_INPUT')
      setImmediate(options.quit)
      return ok(true)
    },
    'app:open-external': async (input: unknown) => {
      const parsed = externalUrlSchema.safeParse(input)
      if (!parsed.success) return fail('INVALID_URL')
      try {
        await options.openExternal(parsed.data)
        return ok(true)
      } catch {
        return fail('COMMAND_FAILED')
      }
    },
  }
}
