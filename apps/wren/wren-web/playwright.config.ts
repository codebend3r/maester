import { FIXTURE_SERVER } from '@raven/core/fixtureServer'
import { fixtureSuiteConfig } from '@tooling/web/playwright'

/*
 * Wren on the web against the fixture's one album, so it opens on Home with no sign-in. The
 * listens a played track counts are the only thing a test leaves behind, and no test reads them.
 */
export default fixtureSuiteConfig({
  projectDir: import.meta.dirname,
  port: FIXTURE_SERVER.wrenWebPort,
})
