import { FIXTURE_SERVER } from '@raven/core/fixtureServer'
import { fixtureSuiteConfig } from '@tooling/web/playwright'

/*
 * raven's web app against the fixture's film, series and album. The one Coming soon request
 * `comingSoon.e2e.ts` makes is the only thing a test leaves behind, and nothing else reads it.
 */
export default fixtureSuiteConfig({ projectDir: import.meta.dirname, port: FIXTURE_SERVER.webPort })
