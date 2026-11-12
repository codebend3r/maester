import { AUTH_CONFIG_STATES } from '@raven/core'
import { describe, expect, it } from 'bun:test'
import { downloadsAccountOf } from '@/browserDownloads/account'
import { LOCAL_ACCOUNT } from '@/browserDownloads/entries'

const USER = '11111111-1111-4111-8111-111111111111'

const SIGNED_OUT = { userId: null, isOffline: false, remembered: null }

describe('downloadsAccountOf', () => {
  it('is the one shared account on a server with accounts off', () => {
    expect(downloadsAccountOf({ ...SIGNED_OUT, authState: AUTH_CONFIG_STATES.off })).toBe(
      LOCAL_ACCOUNT,
    )
  })

  it('is the signed-in account', () => {
    expect(
      downloadsAccountOf({ ...SIGNED_OUT, authState: AUTH_CONFIG_STATES.ready, userId: USER }),
    ).toBe(USER)
  })

  it('is nobody once signed out while the server answers, whoever was here before', () => {
    expect(
      downloadsAccountOf({ ...SIGNED_OUT, authState: AUTH_CONFIG_STATES.ready, remembered: USER }),
    ).toBeNull()
  })

  it('is the account that last signed in while the server is out of reach', () => {
    expect(
      downloadsAccountOf({
        authState: AUTH_CONFIG_STATES.ready,
        userId: null,
        isOffline: true,
        remembered: USER,
      }),
    ).toBe(USER)
  })

  it('is nobody while the server has not said how its accounts stand, or they are down', () => {
    expect(downloadsAccountOf({ ...SIGNED_OUT, authState: null, userId: USER })).toBeNull()
    expect(
      downloadsAccountOf({
        ...SIGNED_OUT,
        authState: AUTH_CONFIG_STATES.unavailable,
        userId: USER,
      }),
    ).toBeNull()
  })

  it('is nobody for an id that could not name a folder', () => {
    expect(
      downloadsAccountOf({
        ...SIGNED_OUT,
        authState: AUTH_CONFIG_STATES.ready,
        userId: '../somewhere',
      }),
    ).toBeNull()
  })
})
