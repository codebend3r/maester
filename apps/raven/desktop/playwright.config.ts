import { defineConfig } from '@playwright/test'

// Every test launches the one built app with its own userData, so they run one at a time.
export default defineConfig({
  testDir: 'e2e',
  // Bun's test runner never picks these up.
  testMatch: '**/*.e2e.ts',
  workers: 1,
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  forbidOnly: !!process.env.CI,
  reporter: 'list',
  use: { trace: 'retain-on-failure' },
  outputDir: 'test-results',
})
