import { describe, expect, it, mock } from 'bun:test'
import { DEFAULT_SERVER_ORIGIN } from '@raven/core'
import { SERVER_ORIGIN_ENV, serverOriginFrom } from '@/main/origins'

const LAN = 'http://192.168.50.6:8484'
const FIXTURE = 'http://127.0.0.1:8490'

describe('serverOriginFrom', () => {
  it("plays from raven's public origin when the build names none", () => {
    const warn = mock()
    expect(serverOriginFrom({ isPackaged: true, built: '', env: {}, warn })).toBe(
      DEFAULT_SERVER_ORIGIN,
    )
    expect(warn).not.toHaveBeenCalled()
  })

  it('plays from the raven the build names', () => {
    expect(serverOriginFrom({ isPackaged: true, built: LAN, env: {}, warn: mock() })).toBe(LAN)
  })

  it("lets an unpackaged run's environment replace it, and never a packaged app's", () => {
    const env = { [SERVER_ORIGIN_ENV]: FIXTURE }
    expect(serverOriginFrom({ isPackaged: false, built: LAN, env, warn: mock() })).toBe(FIXTURE)
    expect(serverOriginFrom({ isPackaged: true, built: LAN, env, warn: mock() })).toBe(LAN)
  })

  it('warns of an origin that is not one, and falls back', () => {
    const warn = mock()
    const env = { [SERVER_ORIGIN_ENV]: 'nas.local' }
    expect(serverOriginFrom({ isPackaged: false, built: 'ftp://x', env, warn })).toBe(
      DEFAULT_SERVER_ORIGIN,
    )
    expect(warn).toHaveBeenCalledTimes(2)
  })
})
