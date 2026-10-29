import { type Account, MEMBER_STATUSES } from '@raven/core'
import { describe, expect, it } from 'vitest'
import { CALLERS, type Caller } from '@/auth/authSessions'
import { Management } from '@/auth/management'
import { readServerConfig } from '@/config'
import { LockService, PRIVACIES } from '@/lock/lockService'
import { AUTH_TEST_CONFIG, AUTH_TEST_IDS } from '@/test/auth'

const LOCKED_LIBRARY = 3
const VIDEO = 7
const ALBUM = 11

const OWNER: Account = {
  id: AUTH_TEST_IDS.owner,
  email: 'owner@maester.test',
  status: MEMBER_STATUSES.approved,
  isOwner: true,
}
const MEMBER: Account = { ...OWNER, id: AUTH_TEST_IDS.friend, isOwner: false }

type LockForProps = { caller: Caller; lockedIds?: () => Set<number> }

/** A lock with one locked library holding one video, read by a caller bound as `caller`. */
const lockFor = ({ caller, lockedIds = () => new Set([LOCKED_LIBRARY]) }: LockForProps) => {
  const sessions = { callerOf: () => caller }
  return new LockService(
    { ...readServerConfig({}), libraryPin: '6006' },
    { lockedIds },
    { libraryOf: (id) => (id === VIDEO ? LOCKED_LIBRARY : null) },
    { librariesHolding: () => [LOCKED_LIBRARY] },
    new Management(AUTH_TEST_CONFIG, { isLocked: () => true }, sessions),
    sessions,
    { libraryOfAlbum: (id) => (id === ALBUM ? LOCKED_LIBRARY : null) },
  )
}

type TicketCallerProps = {
  account: Account
  unlockedUntil?: number
}

const ticketCaller = ({
  account,
  unlockedUntil = Date.now() + 60_000,
}: TicketCallerProps): Caller => ({
  kind: CALLERS.ticket,
  session: { account },
  unlockedUntil,
})

const REQUEST = { headers: {} }

describe('a ticket that carries a PIN unlock', () => {
  it('unlocks nothing for a member, however it came to carry one', () => {
    const lock = lockFor({ caller: ticketCaller({ account: MEMBER }) })
    expect(lock.unlockedUntil({ request: REQUEST })).toBeNull()
    expect(lock.viewer({ request: REQUEST }).sees({ privacy: PRIVACIES.media, id: VIDEO })).toBe(
      false,
    )
  })

  it('unlocks the locked library for the owner until it runs out', () => {
    const unlockedUntil = Date.now() + 60_000
    const lock = lockFor({ caller: ticketCaller({ account: OWNER, unlockedUntil }) })
    expect(lock.unlockedUntil({ request: REQUEST })).toBe(unlockedUntil)
    expect(lock.viewer({ request: REQUEST }).sees({ privacy: PRIVACIES.media, id: VIDEO })).toBe(
      true,
    )
    const expired = lockFor({
      caller: ticketCaller({ account: OWNER, unlockedUntil: Date.now() - 1 }),
    })
    expect(expired.unlockedUntil({ request: REQUEST })).toBeNull()
  })
})

describe('the PIN locking again', () => {
  it('forgets the unlock cookie and tells the passes of the account that locks it, and none for a browser without accounts', () => {
    const owner = lockFor({ caller: ticketCaller({ account: OWNER }) })
    const legacy = lockFor({ caller: { kind: CALLERS.legacy } })
    const told: string[] = []
    const watches = [owner, legacy].map((lock) =>
      lock.relocks.subscribe((accountId) => told.push(accountId)),
    )
    const cookies = [owner, legacy].map((lock) => lock.relock({ request: REQUEST }))
    watches.forEach((watch) => watch.unsubscribe())

    expect(told).toEqual([OWNER.id])
    cookies.forEach((cookie) => expect(cookie).toContain('Max-Age=0'))
  })

  it("answers whether a media needs the unlock by its library's lock as it is asked, not as it was named", () => {
    const state = { locked: new Set<number>() }
    const lock = lockFor({
      caller: ticketCaller({ account: OWNER }),
      lockedIds: () => state.locked,
    })
    const needsUnlock = lock.unlockNeedOf({ mediaId: VIDEO })
    const unfiled = lock.unlockNeedOf({ mediaId: VIDEO + 1 })
    expect(needsUnlock()).toBe(false)
    state.locked = new Set([LOCKED_LIBRARY])
    expect([needsUnlock(), unfiled()]).toEqual([true, false])
  })
})
