import { z } from 'zod'

export const environmentStatusSchema = z.enum([
  'created',
  'ready',
  'starting',
  'running',
  'stopping',
  'stopped',
  'error',
  'needs-recovery',
])
export type EnvironmentStatus = z.infer<typeof environmentStatusSchema>
