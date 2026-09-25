import { z } from 'zod'
import { protocolVersion, externalUrlSchema } from '@contextweave/contracts'

export const workerTaskKindSchema = z.enum(['browser-smoke'])
export type WorkerTaskKind = z.infer<typeof workerTaskKindSchema>

export const workerTaskIdSchema = z.string().min(1).max(128).regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/)

// Main owns the file; the worker receives only this inherited writable descriptor.
export const workerScreenshotDescriptor = 3
export const maxWorkerScreenshotBytes = 32 * 1024 * 1024
export const maxWorkerProtocolBytes = 1024 * 1024

export const browserSmokeTaskInputSchema = z.object({
  url: externalUrlSchema,
  timeoutMs: z.number().int().min(1000).max(120000).default(30000),
}).strict()
export type BrowserSmokeTaskInput = z.infer<typeof browserSmokeTaskInputSchema>

export const workerTaskSchema = z.object({
  protocolVersion: z.literal(protocolVersion),
  taskId: workerTaskIdSchema,
  environmentId: z.string().trim().min(1).max(200),
  kind: workerTaskKindSchema,
  input: browserSmokeTaskInputSchema,
}).strict()
export type WorkerTask = z.infer<typeof workerTaskSchema>

export const workerEventSchema = z.object({
  protocolVersion: z.literal(protocolVersion),
  taskId: workerTaskIdSchema,
  environmentId: z.string().trim().min(1).max(200),
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
  taskId: workerTaskIdSchema,
  environmentId: z.string().trim().min(1).max(200),
  ok: z.boolean(),
  title: z.string().optional(),
  screenshotPath: z.string().optional(),
  errorCode: z.string().optional(),
  errorMessage: z.string().optional(),
})
export type WorkerResult = z.infer<typeof workerResultSchema>

// This private Main -> Worker envelope is never accepted from Renderer as a task.
export const workerProcessRequestSchema = z.object({
  task: workerTaskSchema,
  controlPort: z.number().int().min(1).max(65535),
}).strict()
export type WorkerProcessRequest = z.infer<typeof workerProcessRequestSchema>

// Only Main may attach a filesystem path to the public result.
export const workerProcessResultSchema = workerResultSchema.omit({ screenshotPath: true }).strict()
export type WorkerProcessResult = z.infer<typeof workerProcessResultSchema>
