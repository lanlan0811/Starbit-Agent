import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 30_000,
  reporter: process.env.CI ? [['line']] : [['list']],
  use: {
    trace: 'retain-on-failure'
  }
})
