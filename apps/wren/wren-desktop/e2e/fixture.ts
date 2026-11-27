import { FIXTURE_SERVER } from '@raven/core/fixtureServer'

/**
 * The port this suite's fixture listens on, its own among `FIXTURE_SERVER`'s, so it runs beside
 * the device fixture and the browser suites and never meets a real raven on 8484.
 */
export const FIXTURE_PORT = FIXTURE_SERVER.wrenDesktopPort

/** The fixture's address without its scheme, as Settings shows the server's. */
export const FIXTURE_ADDRESS = `${FIXTURE_SERVER.host}:${FIXTURE_PORT}`

/** The raven the app's `/api` goes to in every test. */
export const FIXTURE_ORIGIN = `http://${FIXTURE_ADDRESS}`
