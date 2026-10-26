import { type Account, MEMBER_STATUSES } from '@raven/core'
import { describe, expect, it } from 'vitest'
import { CALLERS, type Caller } from '@/auth/authSessions'
import { Management } from '@/auth/management'
import { readServerConfig } from '@/config'
import { LockService, PRIVACIES } from '@/lock/lockService'
import { AUTH_TEST_CONFIG, AUTH_TEST_IDS } from '@/test/auth'

const LOCKED_LIBRARY = 3
const VIDEO = 7

const OWNER: Account = {
  id: AUTH_TEST_IDS.owner,
  email: 'owner@maester.test',
  status: MEMBER_STATUSES.approved,
  isOwner: true,
}
const MEMBER: Account = { ...OWNER, id: AUTH_TEST_IDS.friend, isOwner: false }

type LockForProps = { caller: Caller }

/** A lock with one locked library holding one video, read by a caller bound as `caller`. */
const lockFor = ({ caller }: LockForProps) => {
  const sessions = { callerOf: () => caller }
  return new LockService(
    { ...readServerConfig({}), libraryPin: '6006' },
    { lockedIds: () => new Set([LOCKED_LIBRARY]) },
    { libraryOf: () => LOCKED_LIBRARY },
    { librariesHolding: () => [LOCKED_LIBRARY] },
    new Management(AUTH_TEST_CONFIG, { isLocked: () => true }, sessions),
    sessions,
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
  session: { account, token: 'jwt', expiresAt: Date.now() + 60_000 },
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
