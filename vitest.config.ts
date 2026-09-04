import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@core': fileURLToPath(new URL('./src/core', import.meta.url)),
      '@main': fileURLToPath(new URL('./src/main', import.meta.url))
    }
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    clearMocks: true
  }
})
