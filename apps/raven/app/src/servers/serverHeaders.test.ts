import { describe, expect, it } from 'bun:test'
import { AUTH_HEADERS, AUTH_SCHEME, SERVER_COOKIES } from '@raven/core'

import { serverHeadersFor } from '@/servers/serverHeaders'
import { NAS } from '@/test/homeServer'

const TOKEN = 'eyJhbGciOiJFUzI1NiJ9.eyJuIjoiMSJ9.c2ln'
const NO_COOKIES = { cookies: {}, token: null }

describe('serverHeadersFor', () => {
  it("sends the server's cookies to its own API, both of them", () => {
    const headersFor = serverHeadersFor({
      server: NAS,
      credentials: {
        cookies: { [SERVER_COOKIES.unlock]: 'u.1', [SERVER_COOKIES.admin]: 'a.2' },
        token: null,
      },
    })
    expect(headersFor(`${NAS.origin}/api/items/4/images/poster?v=1`)).toEqual({
      [AUTH_HEADERS.cookie]: 'raven_unlock=u.1; raven_admin=a.2',
    })
  })

  it("sends the account's Bearer to a picture and the event stream on the server's own API", () => {
    const headersFor = serverHeadersFor({
      server: NAS,
      credentials: { cookies: { [SERVER_COOKIES.unlock]: 'u.1' }, token: TOKEN },
    })
    const sent = {
      [AUTH_HEADERS.cookie]: `${SERVER_COOKIES.unlock}=u.1`,
      [AUTH_HEADERS.authorization]: `${AUTH_SCHEME} ${TOKEN}`,
    }
    expect(headersFor(`${NAS.origin}/api/items/4/images/poster?v=1`)).toEqual(sent)
    expect(headersFor(`${NAS.origin}/api/events`)).toEqual(sent)
    expect(
      serverHeadersFor({ server: NAS, credentials: { ...NO_COOKIES, token: TOKEN } })(
        `${NAS.origin}/api/home`,
      ),
    ).toEqual({ [AUTH_HEADERS.authorization]: `${AUTH_SCHEME} ${TOKEN}` })
  })

  it('sends nothing off its API, nor when it holds no cookie and no token', () => {
    const headersFor = serverHeadersFor({
      server: NAS,
      credentials: { cookies: { [SERVER_COOKIES.unlock]: 'u.1' }, token: TOKEN },
    })
    expect(headersFor('http://media.example:8484/api/media/1/file')).toEqual({})
    expect(headersFor(`${NAS.origin}.evil.example/api/home`)).toEqual({})
    expect(
      serverHeadersFor({ server: NAS, credentials: NO_COOKIES })(`${NAS.origin}/api/home`),
    ).toEqual({})
  })

  it("throws for an address outside the app's calls, and so gives it nothing", () => {
    const headersFor = serverHeadersFor({
      server: NAS,
      credentials: { cookies: { [SERVER_COOKIES.unlock]: 'u.1' }, token: TOKEN },
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
