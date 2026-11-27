import { describe, expect, it } from 'bun:test'

import { accountSessionOf } from '@/account/supabaseAuth'

describe('accountSessionOf', () => {
  it('keeps the tokens and dates the access token from now', () => {
    expect(
      accountSessionOf({
        accessToken: 'access',
        refreshToken: 'refresh',
        expiresIn: 3600,
        userId: 'user-1',
        email: 'friend@maester.test',
        now: 1000,
      }),
    ).toEqual({
      accessToken: 'access',
      refreshToken: 'refresh',
      expiresAt: 3_601_000,
      userId: 'user-1',
      email: 'friend@maester.test',
    })
  })
})
