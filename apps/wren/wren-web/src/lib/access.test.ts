import { describe, expect, it } from 'bun:test'
import { AUTH_CONFIG_STATES } from '@raven/core'
import { ACCESS_KINDS, accessOf } from '@/lib/access'
import { AUTH_SESSION_STATUSES } from '@/stores/authSession'
import { SIGNED_IN, readyConfig } from '@/test/authClient'

const READY = { data: readyConfig, error: null }

describe('accessOf', () => {
  it("waits while the server's word on accounts is on its way", () => {
    expect(
      accessOf({
        config: { data: undefined, error: null },
        status: AUTH_SESSION_STATUSES.booting,
        session: null,
      }),
    ).toBe(ACCESS_KINDS.loading)
  })

  it('opens every page on a server with accounts off, which has no sign-in', () => {
    expect(
      accessOf({
        config: { data: { state: AUTH_CONFIG_STATES.off }, error: null },
        status: AUTH_SESSION_STATUSES.booting,
        session: null,
      }),
    ).toBe(ACCESS_KINDS.open)
  })

  it('waits for the session to be read before deciding anyone is signed out', () => {
    expect(accessOf({ config: READY, status: AUTH_SESSION_STATUSES.booting, session: null })).toBe(
      ACCESS_KINDS.loading,
    )
  })

  it('lets a signed-in listener in, and sends anyone else to sign in', () => {
    expect(
      accessOf({ config: READY, status: AUTH_SESSION_STATUSES.ready, session: SIGNED_IN }),
    ).toBe(ACCESS_KINDS.open)
    expect(accessOf({ config: READY, status: AUTH_SESSION_STATUSES.ready, session: null })).toBe(
      ACCESS_KINDS.signedOut,
    )
  })

  it('sends the listener to sign-in, which says so, when raven or its accounts cannot be reached', () => {
    expect(
      accessOf({
        config: { data: undefined, error: new Error('Failed to fetch') },
        status: AUTH_SESSION_STATUSES.booting,
        session: null,
      }),
    ).toBe(ACCESS_KINDS.signedOut)
    expect(
      accessOf({
        config: { data: { state: AUTH_CONFIG_STATES.unavailable }, error: null },
        status: AUTH_SESSION_STATUSES.booting,
        session: null,
      }),
    ).toBe(ACCESS_KINDS.signedOut)
  })
})
