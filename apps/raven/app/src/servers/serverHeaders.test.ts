import { describe, expect, it } from 'bun:test'
import { AUTH_HEADERS, SERVER_COOKIES } from '@raven/core'

import { cookieHeadersFor } from '@/servers/serverHeaders'
import { NAS } from '@/test/homeServer'

describe('cookieHeadersFor', () => {
  it("sends the server's cookies to its own API, both of them", () => {
    const headersFor = cookieHeadersFor({
      server: NAS,
      cookies: { [SERVER_COOKIES.unlock]: 'u.1', [SERVER_COOKIES.admin]: 'a.2' },
    })
    expect(headersFor(`${NAS.origin}/api/items/4/images/poster?v=1`)).toEqual({
      [AUTH_HEADERS.cookie]: 'raven_unlock=u.1; raven_admin=a.2',
    })
  })

  it('sends nothing off its API, nor when it holds no cookie', () => {
    const headersFor = cookieHeadersFor({
      server: NAS,
      cookies: { [SERVER_COOKIES.unlock]: 'u.1' },
    })
    expect(headersFor('http://media.example:8484/api/media/1/file')).toEqual({})
    expect(cookieHeadersFor({ server: NAS, cookies: {} })(`${NAS.origin}/api/home`)).toEqual({})
  })

  it("throws for an address outside the app's calls, and so gives it no cookie", () => {
    const headersFor = cookieHeadersFor({
      server: NAS,
      cookies: { [SERVER_COOKIES.unlock]: 'u.1' },
    })
    expect(() => headersFor(`${NAS.origin}/assets/logo.png`)).toThrow(
      `raven's app does not call GET ${NAS.origin}/assets/logo.png`,
    )
    expect(() => headersFor(`${NAS.origin}/api/media/4/location?t=secret`)).toThrow(
      `raven's app does not call GET ${NAS.origin}/api/media/4/location`,
    )
    expect(() => headersFor(`${NAS.origin}/api/items/4/images/poster/../../metadata`)).toThrow()
  })
})
