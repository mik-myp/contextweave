import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { alias: { '@': resolve(__dirname, 'src') } },
  // Serialize Windows disk fixtures: two file workers still overlapped slow real
  // SQLite/fsync tests. Keep original timeouts and concurrency within each test.
  test: { maxWorkers: process.platform === 'win32' ? 1 : 2 },
})
