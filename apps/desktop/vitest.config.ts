import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { alias: { '@': resolve(__dirname, 'src') } },
  // Real SQLite and credential fsync fixtures share the runner's disk. Bound file-level
  // contention without relaxing timeouts or changing concurrency within a test.
  test: { maxWorkers: 2 },
})
