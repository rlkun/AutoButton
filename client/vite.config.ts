import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        entry: 'electron/main.ts',
        vite: {
          build: {
            rollupOptions: {
              external: ['robotjs'],
            },
          },
        },
      },
      {
        entry: 'electron/preload.js',
        onstart(options) {
          options.reload()
        },
        vite: {
          build: {
            lib: {
              entry: 'electron/preload.js',
              formats: ['cjs'],
            },
            rollupOptions: {
              output: {
                entryFileNames: '[name].js',
              },
            },
          },
        },
      },
    ]),
  ],
})
