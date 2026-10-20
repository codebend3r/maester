import { MEMBER_STATUSES, type Account } from '@raven/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthBackend } from '@/auth/authBackend'
import { MAX_LOOKUPS, MEMBERSHIP_TTL_MS, MembershipLookups } from '@/auth/membershipLookups'
import { AUTH_TEST_IDS } from '@/test/auth'

const START = new Date('2026-10-19T12:00:00.000Z')
const CONCURRENT_CALLS = 50
const TOKENS = { first: 'first-token', second: 'second-token', other: 'other-token' } as const

const accountOf = ({ id }: { id: string }): Account => ({
  id,
  email: `${id}@maester.test`,
  status: MEMBER_STATUSES.approved,
  isOwner: false,
})

type Lookup = (args: { token: string }) => Promise<Account | null>

/** Lookups over a backend that answers for the friend, or for whoever `answer` names. */
const setup = ({
  answer = async () => accountOf({ id: AUTH_TEST_IDS.friend }),
}: { answer?: Lookup } = {}) => {
  const current = vi.fn<Lookup>(answer)
  const backend: Pick<AuthBackend, 'current'> = { current }
  return { current, lookups: new MembershipLookups(backend, MEMBERSHIP_TTL_MS) }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(START)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('coalesced membership lookups', () => {
  it('shares one backend call between concurrent lookups of a token', async () => {
    const { current, lookups } = setup()
    const accounts = await Promise.all(
      Array.from({ length: CONCURRENT_CALLS }, () => lookups.current({ token: TOKENS.first })),
    )
    expect(current).toHaveBeenCalledTimes(1)
    expect(accounts).toEqual(
      Array.from({ length: CONCURRENT_CALLS }, () => accountOf({ id: AUTH_TEST_IDS.friend })),
    )
  })

  it('looks a token up on its own, apart from other tokens', async () => {
    const { current, lookups } = setup()
    await Promise.all([
      lookups.current({ token: TOKENS.first }),
      lookups.current({ token: TOKENS.other }),
    ])
    expect(current).toHaveBeenCalledTimes(2)
  })

  it('reuses an answer until the TTL is up, and asks again from then on', async () => {
    const { current, lookups } = setup()
    await lookups.current({ token: TOKENS.first })
    vi.advanceTimersByTime(MEMBERSHIP_TTL_MS - 1)
    await lookups.current({ token: TOKENS.first })
    expect(current).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1)
    await lookups.current({ token: TOKENS.first })
    expect(current).toHaveBeenCalledTimes(2)
  })

  it('asks again at the TTL plus a millisecond', async () => {
    const { current, lookups } = setup()
    await lookups.current({ token: TOKENS.first })
    vi.advanceTimersByTime(MEMBERSHIP_TTL_MS + 1)
    await lookups.current({ token: TOKENS.first })
    expect(current).toHaveBeenCalledTimes(2)
  })

  it('counts the TTL from when the lookup began, so a slow answer is not served past it', async () => {
    const SLOW_MS = 3_000
    const { current, lookups } = setup({
      answer: () =>
        new Promise((resolve) => {
          setTimeout(() => resolve(accountOf({ id: AUTH_TEST_IDS.friend })), SLOW_MS)
        }),
    })
    const first = lookups.current({ token: TOKENS.first })
    await vi.advanceTimersByTimeAsync(SLOW_MS)
    await first
    await vi.advanceTimersByTimeAsync(MEMBERSHIP_TTL_MS - SLOW_MS)
    const second = lookups.current({ token: TOKENS.first })
    await vi.advanceTimersByTimeAsync(SLOW_MS)
    await second
    expect(current).toHaveBeenCalledTimes(2)
  })

  it('reuses an answer of no membership as well', async () => {
    const { current, lookups } = setup({ answer: async () => null })
    expect(await lookups.current({ token: TOKENS.first })).toBeNull()
    expect(await lookups.current({ token: TOKENS.first })).toBeNull()
    expect(current).toHaveBeenCalledTimes(1)
  })

  it('never reuses a failed lookup, though callers waiting on it all see the failure', async () => {
    const outage = new Error('Network unavailable')
    const { current, lookups } = setup()
    current.mockRejectedValueOnce(outage)
    await Promise.all([
      expect(lookups.current({ token: TOKENS.first })).rejects.toBe(outage),
      expect(lookups.current({ token: TOKENS.first })).rejects.toBe(outage),
    ])
    expect(current).toHaveBeenCalledTimes(1)
    expect(await lookups.current({ token: TOKENS.first })).toEqual(
      accountOf({ id: AUTH_TEST_IDS.friend }),
    )
    expect(current).toHaveBeenCalledTimes(2)
  })

  it('never reuses a lookup whose backend threw before returning a promise', async () => {
    const outage = new Error('Network unavailable')
    const { current, lookups } = setup()
    current.mockImplementationOnce(() => {
      throw outage
    })
    await expect(lookups.current({ token: TOKENS.first })).rejects.toBe(outage)
    expect(await lookups.current({ token: TOKENS.first })).toEqual(
      accountOf({ id: AUTH_TEST_IDS.friend }),
    )
    expect(current).toHaveBeenCalledTimes(2)
  })

  it('looks up afresh after forgetting the account', async () => {
    const { current, lookups } = setup()
    await lookups.current({ token: TOKENS.first })
    lookups.forget({ accountId: AUTH_TEST_IDS.friend })
    await lookups.current({ token: TOKENS.first })
    expect(current).toHaveBeenCalledTimes(2)
  })

  it('forgets every token of the account and no other account', async () => {
    const { current, lookups } = setup({
      answer: async ({ token }) =>
        accountOf({ id: token === TOKENS.other ? AUTH_TEST_IDS.owner : AUTH_TEST_IDS.friend }),
    })
    await Promise.all(Object.values(TOKENS).map((token) => lookups.current({ token })))
    expect(current).toHaveBeenCalledTimes(3)
    lookups.forget({ accountId: AUTH_TEST_IDS.friend })
    await Promise.all(Object.values(TOKENS).map((token) => lookups.current({ token })))
    expect(current).toHaveBeenCalledTimes(5)
  })

  it('does not hand a lookup begun before a forget to a caller after it, nor keep its answer', async () => {
    const release: Array<() => void> = []
    const { current, lookups } = setup({
      answer: () =>
        new Promise((resolve) => {
          release.push(() => resolve(accountOf({ id: AUTH_TEST_IDS.friend })))
        }),
    })
    const before = lookups.current({ token: TOKENS.first })
    lookups.forget({ accountId: AUTH_TEST_IDS.friend })
    const after = lookups.current({ token: TOKENS.first })
    expect(current).toHaveBeenCalledTimes(2)
    release.forEach((resolve) => resolve())
    await Promise.all([before, after])
    await lookups.current({ token: TOKENS.first })
    expect(current).toHaveBeenCalledTimes(2)
  })

  it('does not cache the answer of a lookup that a forget overtook', async () => {
    const release: Array<() => void> = []
    const { current, lookups } = setup({
      answer: () =>
        new Promise((resolve) => {
          release.push(() => resolve(accountOf({ id: AUTH_TEST_IDS.friend })))
        }),
    })
    const overtaken = lookups.current({ token: TOKENS.first })
    lookups.forget({ accountId: AUTH_TEST_IDS.friend })
    release.forEach((resolve) => resolve())
    await overtaken
    const next = lookups.current({ token: TOKENS.first })
    release.forEach((resolve) => resolve())
    await next
    expect(current).toHaveBeenCalledTimes(2)
  })

  it('holds no more than the cap, dropping the oldest first', async () => {
    const { current, lookups } = setup()
    const tokenAt = (index: number) => `token-${index}`
    await Promise.all(
      Array.from({ length: MAX_LOOKUPS + 1 }, (_, index) =>
        lookups.current({ token: tokenAt(index) }),
      ),
    )
    expect(current).toHaveBeenCalledTimes(MAX_LOOKUPS + 1)
    await lookups.current({ token: tokenAt(MAX_LOOKUPS) })
    expect(current).toHaveBeenCalledTimes(MAX_LOOKUPS + 1)
    await lookups.current({ token: tokenAt(0) })
    expect(current).toHaveBeenCalledTimes(MAX_LOOKUPS + 2)
  })
})
