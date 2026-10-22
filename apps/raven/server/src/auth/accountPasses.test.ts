import { MEMBER_STATUSES, type Account } from '@raven/core'
import { NEVER, Subject, of } from 'rxjs'
import { describe, expect, it, vi } from 'vitest'
import { ACCOUNT_PASS_MS, type AccountPass, openPass } from '@/auth/accountPasses'
import type { Clock } from '@/clock'
import { AUTH_TEST_IDS } from '@/test/auth'
import { STILL_CLOCK, manualClock } from '@/test/clock'

const FRIEND: Account = {
  id: AUTH_TEST_IDS.friend,
  email: 'friend@maester.test',
  status: MEMBER_STATUSES.approved,
  isOwner: false,
}
const SECRET = 'account.0123456789abcdefghijklmnopqrstuvwxyzABCDEFG'
const MEDIA = 7
/** An hour: a pass is used far more often than this, and its deadline falls on one. */
const HOUR_MS = 60 * 60 * 1000

/** Whether a pass's media sits in a locked library, as the test says it does at each moment. */
const LIBRARIES = { locked: 'locked', open: 'open' } as const

/**
 * A pass for the friend on `MEDIA`, minted under `unlockedUntil`, with the
 * subjects that end its access and lock the PIN again, what its holder was
 * told, and a switch for whether its media's library is locked.
 */
const opened = ({
  clock = manualClock().clock,
  unlockedUntil = 42,
  library = LIBRARIES.open,
}: {
  clock?: Clock
  unlockedUntil?: number | null
  library?: (typeof LIBRARIES)[keyof typeof LIBRARIES]
} = {}) => {
  const ended = new Subject<void>()
  const relocked = new Subject<void>()
  const state = { library }
  const onEnd = vi.fn<() => void>()
  const pass = openPass({
    secret: SECRET,
    mediaId: MEDIA,
    access: {
      account: FRIEND,
      unlockedUntil,
      ended,
      relocked,
      needsUnlock: () => state.library === LIBRARIES.locked,
    },
    clock,
    onEnd,
  })
  const setLibrary = (next: (typeof LIBRARIES)[keyof typeof LIBRARIES]): void => {
    state.library = next
  }
  return { pass, ended, relocked, onEnd, setLibrary }
}

const grantOf = (pass: AccountPass) => pass.grantFor({ given: SECRET, mediaId: MEDIA })

describe('an account pass', () => {
  it('grants its account and unlock for its own secret on its own media, and nothing else', () => {
    const { pass } = opened()
    expect(pass.grantFor({ given: SECRET, mediaId: MEDIA })).toEqual({
      account: FRIEND,
      unlockedUntil: 42,
    })
    expect(
      [
        { given: SECRET, mediaId: MEDIA + 1 },
        { given: `${SECRET.slice(0, -1)}H`, mediaId: MEDIA },
        { given: SECRET.toUpperCase(), mediaId: MEDIA },
        { given: undefined, mediaId: MEDIA },
        { given: [SECRET], mediaId: MEDIA },
        { given: '', mediaId: MEDIA },
      ].map((asked) => pass.grantFor(asked)),
    ).toEqual([null, null, null, null, null, null])
  })

  it('ends at its deadline from when it opened, however often it was used, and tells its holder once', () => {
    const { clock, advance, pending } = manualClock()
    const { pass, ended, onEnd } = opened({ clock })
    const hourly = Array.from({ length: ACCOUNT_PASS_MS / HOUR_MS - 1 }, () => {
      advance(HOUR_MS)
      return pass.grantFor({ given: SECRET, mediaId: MEDIA }) !== null
    })
    advance(HOUR_MS - 1)
    const justBefore = pass.grantFor({ given: SECRET, mediaId: MEDIA }) !== null
    advance(1)

    expect(hourly).toEqual(hourly.map(() => true))
    expect(justBefore).toBe(true)
    expect(pass.grantFor({ given: SECRET, mediaId: MEDIA })).toBeNull()
    expect(onEnd).toHaveBeenCalledTimes(1)
    expect(ended.observed).toBe(false)
    expect(pending()).toBe(0)
  })

  it('ends at a request past its deadline when its timer never fired, as on a host that slept', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      const { pass, onEnd } = opened({ clock: STILL_CLOCK })
      vi.setSystemTime(Date.now() + ACCOUNT_PASS_MS - 1)
      expect(pass.grantFor({ given: SECRET, mediaId: MEDIA })).not.toBeNull()
      vi.setSystemTime(Date.now() + 1)
      expect(pass.grantFor({ given: SECRET, mediaId: MEDIA })).toBeNull()
      expect(onEnd).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('ends when its account loses access, and stops watching it and its deadline', () => {
    const { clock, pending } = manualClock()
    const { pass, ended, onEnd } = opened({ clock })
    ended.next()

    expect(pass.grantFor({ given: SECRET, mediaId: MEDIA })).toBeNull()
    expect(onEnd).toHaveBeenCalledTimes(1)
    expect(ended.observed).toBe(false)
    expect(pending()).toBe(0)
  })

  it('ends once when its holder ends it, however many times', () => {
    const { clock, pending } = manualClock()
    const { pass, ended, onEnd } = opened({ clock })
    pass.end()
    pass.end()
    ended.next()

    expect(pass.grantFor({ given: SECRET, mediaId: MEDIA })).toBeNull()
    expect(onEnd).toHaveBeenCalledTimes(1)
    expect(ended.observed).toBe(false)
    expect(pending()).toBe(0)
  })

  it('ends at once when its account has already lost access as it opens', () => {
    const { clock, pending } = manualClock()
    const onEnd = vi.fn<() => void>()
    const pass = openPass({
      secret: SECRET,
      mediaId: MEDIA,
      // A recheck that finds no live token for the account emits as it is subscribed to.
      access: {
        account: FRIEND,
        unlockedUntil: null,
        ended: of(undefined),
        relocked: NEVER,
        needsUnlock: () => false,
      },
      clock,
      onEnd,
    })

    expect(pass.grantFor({ given: SECRET, mediaId: MEDIA })).toBeNull()
    expect(onEnd).toHaveBeenCalledTimes(1)
    expect(pending()).toBe(0)
  })

  it('ends at once as the PIN locks again, when its media is in a locked library', () => {
    const { clock, pending } = manualClock()
    const { pass, ended, relocked, onEnd } = opened({
      clock,
      unlockedUntil: HOUR_MS,
      library: LIBRARIES.locked,
    })
    relocked.next()

    expect(grantOf(pass)).toBeNull()
    expect(onEnd).toHaveBeenCalledTimes(1)
    expect([ended.observed, relocked.observed]).toEqual([false, false])
    expect(pending()).toBe(0)
  })

  it('outlives a relock when its media is in an unlocked library, and gives up the unlock it no longer holds', () => {
    const { clock } = manualClock()
    const { pass, relocked, onEnd } = opened({ clock, unlockedUntil: HOUR_MS })
    relocked.next()

    expect(grantOf(pass)).toEqual({ account: FRIEND, unlockedUntil: null })
    expect(onEnd).not.toHaveBeenCalled()
    expect(relocked.observed).toBe(true)
  })

  it("reads its library's lock as the PIN locks again, not as the pass opened", () => {
    const { clock } = manualClock()
    const lockedSince = opened({ clock, unlockedUntil: HOUR_MS })
    const openedSince = opened({ clock, unlockedUntil: HOUR_MS, library: LIBRARIES.locked })
    lockedSince.setLibrary(LIBRARIES.locked)
    openedSince.setLibrary(LIBRARIES.open)
    lockedSince.relocked.next()
    openedSince.relocked.next()

    expect(grantOf(lockedSince.pass)).toBeNull()
    expect(grantOf(openedSince.pass)).toEqual({ account: FRIEND, unlockedUntil: null })
  })

  it('takes no notice of a relock when it holds no unlock, whatever its library', () => {
    const { clock } = manualClock()
    const { pass, relocked, onEnd } = opened({
      clock,
      unlockedUntil: null,
      library: LIBRARIES.locked,
    })
    relocked.next()

    expect(grantOf(pass)).toEqual({ account: FRIEND, unlockedUntil: null })
    expect(onEnd).not.toHaveBeenCalled()
  })

  it('ends as its unlock lapses when its media is in a locked library, and not before', () => {
    const { clock, advance, pending } = manualClock()
    const { pass, ended, relocked, onEnd } = opened({
      clock,
      unlockedUntil: HOUR_MS,
      library: LIBRARIES.locked,
    })
    advance(HOUR_MS - 1)
    expect(grantOf(pass)).not.toBeNull()
    advance(1)

    expect(grantOf(pass)).toBeNull()
    expect(onEnd).toHaveBeenCalledTimes(1)
    expect([ended.observed, relocked.observed]).toEqual([false, false])
    expect(pending()).toBe(0)
  })

  it('outlives its unlock lapsing when its media is in an unlocked library', () => {
    const { clock, advance } = manualClock()
    const { pass, onEnd } = opened({ clock, unlockedUntil: HOUR_MS })
    advance(HOUR_MS)

    expect(grantOf(pass)).toEqual({ account: FRIEND, unlockedUntil: null })
    expect(onEnd).not.toHaveBeenCalled()
  })

  it('ends at a request past its unlock when the timer never fired, as on a host that slept', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      const unlockedUntil = Date.now() + HOUR_MS
      const { pass, onEnd } = opened({
        clock: STILL_CLOCK,
        unlockedUntil,
        library: LIBRARIES.locked,
      })
      vi.setSystemTime(unlockedUntil - 1)
      expect(grantOf(pass)).not.toBeNull()
      vi.setSystemTime(unlockedUntil)
      expect(grantOf(pass)).toBeNull()
      expect(onEnd).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })
})
