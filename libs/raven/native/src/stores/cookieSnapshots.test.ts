import { describe, expect, it } from 'bun:test'
import { SERVER_COOKIES } from '@raven/core'

import { isUnlockedBy, noteCookies, unlockNow, useCookieSnapshots } from '@/stores/cookieSnapshots'

const SERVER_ID = 'a8d1c0f2-3b4e-4c5d-8e9f-0a1b2c3d4e5f'
const OTHER_ID = 'b9e2d1a3-4c5f-4d6e-9fa0-1b2c3d4e5f60'

describe('cookie snapshots', () => {
  it('keeps each server apart and says the unlock only once its cookies hold one', () => {
    expect(unlockNow(SERVER_ID)).toBe(false)
    noteCookies({ serverId: SERVER_ID, cookies: { [SERVER_COOKIES.unlock]: 'token' } })
    noteCookies({ serverId: OTHER_ID, cookies: {} })
    expect(useCookieSnapshots.getState().byServer[SERVER_ID]).toEqual({
      [SERVER_COOKIES.unlock]: 'token',
    })
    expect(unlockNow(SERVER_ID)).toBe(true)
    expect(unlockNow(OTHER_ID)).toBe(false)
    noteCookies({ serverId: SERVER_ID, cookies: {} })
    expect(unlockNow(SERVER_ID)).toBe(false)
  })

  it('reads no cookies, and an empty unlock, as locked', () => {
    expect(isUnlockedBy(null)).toBe(false)
    expect(isUnlockedBy({ [SERVER_COOKIES.unlock]: '' })).toBe(false)
  })
})
