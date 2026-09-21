import { z } from 'zod'
import { protocolVersion } from '@contextweave/contracts'

export const workerTaskKindSchema = z.enum(['browser-smoke'])
export type WorkerTaskKind = z.infer<typeof workerTaskKindSchema>

export const browserSmokeTaskInputSchema = z.object({
  url: z.string().url(),
  screenshotPath: z.string().trim().min(1).optional(),
  timeoutMs: z.number().int().min(1000).max(120000).default(30000),
})
export type BrowserSmokeTaskInput = z.infer<typeof browserSmokeTaskInputSchema>

export const workerTaskSchema = z.object({
  protocolVersion: z.literal(protocolVersion),
  taskId: z.string().trim().min(1),
  environmentId: z.string().trim().min(1),
  kind: workerTaskKindSchema,
  input: browserSmokeTaskInputSchema,
})
export type WorkerTask = z.infer<typeof workerTaskSchema>

export const workerEventSchema = z.object({
  protocolVersion: z.literal(protocolVersion),
  taskId: z.string().trim().min(1),
  environmentId: z.string().trim().min(1),
  step: z.string().trim().min(1),
  status: z.enum(['started', 'running', 'completed', 'failed', 'cancelled']),
  at: z.string().datetime(),
  code: z.string().trim().min(1).optional(),
  message: z.string().trim().min(1).optional(),
  data: z.record(z.string(), z.unknown()).optional(),
})
export type WorkerEvent = z.infer<typeof workerEventSchema>

export const workerResultSchema = z.object({
  protocolVersion: z.literal(protocolVersion),
  taskId: z.string().trim().min(1),
  environmentId: z.string().trim().min(1),
  ok: z.boolean(),
  title: z.string().optional(),
  screenshotPath: z.string().optional(),
  errorCode: z.string().optional(),
  errorMessage: z.string().optional(),
})
export type WorkerResult = z.infer<typeof workerResultSchema>