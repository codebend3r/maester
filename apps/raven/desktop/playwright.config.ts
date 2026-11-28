import { defineConfig } from '@playwright/test'
import { SUITE_DEFAULTS } from '@tooling/web/playwright'
import { ignoredSpecsFor } from '@/e2e/platformSpecs'
import { desktopPlatformFor } from '@/shared/platform'

/*
 * Every test launches the one built app with its own userData, so they run one at a time. The
 * config reads the platform itself rather than through `e2e/platform.ts`, which loads `@raven/mpv`:
 * knip loads this file in a job that never builds that library.
 */
export default defineConfig({
  ...SUITE_DEFAULTS,
  // A spec only the other system can run is left out; `e2e/platformSpecs.ts` lists them and says why.
  testIgnore: ignoredSpecsFor({ platform: desktopPlatformFor({ platform: process.platform }) }),
  workers: 1,
  timeout: 60_000,
  use: { trace: 'retain-on-failure' },
})
