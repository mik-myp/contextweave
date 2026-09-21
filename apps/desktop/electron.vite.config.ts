import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const workspaceDependencies = [
  '@contextweave/contracts',
  '@contextweave/kernel-core',
  '@contextweave/kernel-fingerprint-chromium',
  '@contextweave/kernel-standard-chromium',
  '@contextweave/storage',
  '@contextweave/worker-protocol',
]

export default defineConfig({
  main: {
    build: {
      outDir: resolve(__dirname, 'dist-electron'),
      rollupOptions: {
        input: {
          main: resolve(__dirname, 'electron/main.ts'),
          worker: resolve(__dirname, 'electron/worker.ts'),
        },
      },
    },
    plugins: [externalizeDepsPlugin({ exclude: workspaceDependencies })],
  },
  preload: {
    build: {
      outDir: resolve(__dirname, 'dist-electron'),
      emptyOutDir: false,
      rollupOptions: {
        input: resolve(__dirname, 'electron/preload.ts'),
      },
    },
    plugins: [externalizeDepsPlugin({ exclude: workspaceDependencies })],
  },
  renderer: {
    root: resolve(__dirname),
    build: {
      outDir: resolve(__dirname, 'dist'),
      rollupOptions: {
        input: resolve(__dirname, 'index.html'),
      },
    },
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
      },
    },
    plugins: [react(), tailwindcss()],
  },
})
