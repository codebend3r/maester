import { describe, expect, it } from 'bun:test'
import { create } from 'zustand'

import { accountIdOf, forgetOnAccountChange } from '@/account/accountChange'
import type { AccountSession } from '@/account/supabaseAuth'

type SessionOfProps = { userId: string; accessToken: string }

const sessionOf = ({ userId, accessToken }: SessionOfProps): AccountSession => ({
  userId,
  email: `${userId}@example.com`,
  accessToken,
  refreshToken: 'refresh',
  expiresAt: 0,
})

const storeOf = () => create<{ session: AccountSession | null }>()(() => ({ session: null }))

describe('forgetOnAccountChange', () => {
  it('forgets on every change of account, signing out included', () => {
    const session = storeOf()
    const heard: (string | null)[] = []
    const cleared: string[] = []
    const stop = forgetOnAccountChange({
      session,
      cache: { clear: () => cleared.push('cache') },
      alsoForget: ({ accountId }) => heard.push(accountId),
    })
    session.setState({ session: sessionOf({ userId: 'ana', accessToken: 'token' }) })
    session.setState({ session: sessionOf({ userId: 'ben', accessToken: 'token' }) })
    session.setState({ session: null })
    stop()
    session.setState({ session: sessionOf({ userId: 'cy', accessToken: 'token' }) })
    expect(heard).toEqual(['ana', 'ben', null])
    expect(cleared).toEqual(['cache', 'cache', 'cache'])
  })

  it('keeps everything through a renewed token', () => {
    const session = storeOf()
    session.setState({ session: sessionOf({ userId: 'ana', accessToken: 'token' }) })
    const heard: (string | null)[] = []
    forgetOnAccountChange({
      session,
      cache: { clear: () => heard.push('cleared') },
      alsoForget: ({ accountId }) => heard.push(accountId),
    })
    session.setState({ session: sessionOf({ userId: 'ana', accessToken: 'renewed' }) })
    expect(heard).toEqual([])
    expect(accountIdOf(session.getState())).toBe('ana')
  })
})
