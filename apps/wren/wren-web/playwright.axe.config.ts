import { FIXTURE_SERVER } from '@raven/core/fixtureServer'
import { fixtureSuiteConfig } from '@tooling/web/playwright'

// axe-core over Wren on the web's pages, against the same fixture as the flows.
export default fixtureSuiteConfig({
  projectDir: import.meta.dirname,
  port: FIXTURE_SERVER.wrenWebPort,
  suite: 'axe',
})
