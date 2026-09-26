import { z } from 'zod'
import { protocolVersion, externalUrlSchema } from '@contextweave/contracts'

export const workerTaskKindSchema = z.enum(['browser-smoke'])
export type WorkerTaskKind = z.infer<typeof workerTaskKindSchema>

export const workerTaskIdSchema = z.string().min(1).max(128).regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/)

// Main owns all output descriptors; the child only sends bounded private messages.
export const maxWorkerScreenshotChunkBytes = 64 * 1024
export const workerTransportVersion = 1
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
  control: z.object({ port: z.number().int().min(1).max(65535), token: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
}).strict()
export type WorkerProcessRequest = z.infer<typeof workerProcessRequestSchema>

// Only Main may attach a filesystem path to the public result.
const workerResultIdentity = workerResultSchema.pick({
  protocolVersion: true, taskId: true, environmentId: true,
})
export const workerProcessResultSchema = z.discriminatedUnion('ok', [
  workerResultIdentity.extend({ ok: z.literal(true), title: z.string().max(4096).optional() }).strict(),
  workerResultIdentity.extend({
    ok: z.literal(false),
    errorCode: z.literal('WORKER_ERROR'),
    errorMessage: z.literal('Worker execution failed'),
  }).strict(),
])
export type WorkerProcessResult = z.infer<typeof workerProcessResultSchema>


const transportVersion = z.literal(workerTransportVersion)
const chunkSequence = z.number().int().min(0).max(maxWorkerScreenshotBytes / maxWorkerScreenshotChunkBytes - 1)
const screenshotSize = z.number().int().min(8).max(maxWorkerScreenshotBytes)
const screenshotChunk = z.instanceof(Uint8Array).refine((data) =>
  data.byteLength > 0 && data.byteLength <= maxWorkerScreenshotChunkBytes &&
  data.buffer instanceof ArrayBuffer && data.byteOffset === 0 &&
  data.buffer.byteLength === data.byteLength,
)

export const workerChildMessageSchema = z.discriminatedUnion('type', [
  z.object({ version: transportVersion, type: z.literal('ready') }).strict(),
  z.object({ version: transportVersion, type: z.literal('screenshot-start'), bytes: screenshotSize }).strict(),
  z.object({ version: transportVersion, type: z.literal('screenshot-chunk'), sequence: chunkSequence, data: screenshotChunk }).strict(),
  z.object({ version: transportVersion, type: z.literal('screenshot-end'), bytes: screenshotSize,
    chunks: z.number().int().min(1).max(maxWorkerScreenshotBytes / maxWorkerScreenshotChunkBytes),
  }).strict(),
  z.object({ version: transportVersion, type: z.literal('result'), result: workerProcessResultSchema }).strict(),
])
export type WorkerChildMessage = z.infer<typeof workerChildMessageSchema>

export const workerParentMessageSchema = z.discriminatedUnion('type', [
  z.object({ version: transportVersion, type: z.literal('request'), request: workerProcessRequestSchema }).strict(),
  z.object({ version: transportVersion, type: z.literal('chunk-ack'), sequence: chunkSequence }).strict(),
  z.object({ version: transportVersion, type: z.literal('result-ack') }).strict(),
])
export type WorkerParentMessage = z.infer<typeof workerParentMessageSchema>
