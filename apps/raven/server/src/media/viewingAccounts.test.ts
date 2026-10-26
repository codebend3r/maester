import { Logger } from '@nestjs/common'
import { AUTH_CONFIG_STATES, MEMBER_STATUSES, type Account, type AuthConfig } from '@raven/core'
import { describe, expect, it, vi } from 'vitest'
import { CALLERS, type Caller } from '@/auth/authSessions'
import { ADOPTION_RETRY_MS, ViewingAccounts } from '@/media/viewingAccounts'
import { VIEWING_ACCOUNTS } from '@/media/viewingAccountKeys'
import type { AdoptedCounts, ViewingAdoption } from '@/media/viewingAdoption'
import { AUTH_TEST_CONFIG, AUTH_TEST_IDS } from '@/test/auth'

const MEMBER: Account = {
  id: AUTH_TEST_IDS.friend,
  email: 'friend@maester.test',
  status: MEMBER_STATUSES.approved,
  isOwner: false,
}

const OWNER: Account = {
  id: AUTH_TEST_IDS.owner,
  email: 'owner@maester.test',
  status: MEMBER_STATUSES.approved,
  isOwner: true,
}

const OFF: AuthConfig = { state: AUTH_CONFIG_STATES.off }

const REQUEST = {}

const ADOPTED = {
  spots: 1,
  plays: 2,
  favourites: 3,
  titleFavourites: 4,
} as const satisfies AdoptedCounts

const SQLITE_CODES = { full: 'SQLITE_FULL' } as const

const sessionOf = (account: Account): Caller => ({
  kind: CALLERS.session,
  session: { account, token: 'jwt', expiresAt: 1 },
  isBearer: true,
})

const ticketOf = (account: Account): Caller => ({
  kind: CALLERS.ticket,
  session: { account },
  unlockedUntil: null,
})

type CallerOfProps = { request: object }

type AccountsForProps = {
  auth?: AuthConfig
  owner?: string | null
  hasPast?: boolean
  callerOf?: (asked: CallerOfProps) => Caller
}

/** The accounts as a server in `auth` builds them, with `owner` recorded and `hasPast` saying whether rows from before accounts remain. */
const accountsFor = ({
  auth = AUTH_TEST_CONFIG,
  owner = null,
  hasPast = false,
  callerOf = () => ({ kind: CALLERS.legacy }),
}: AccountsForProps) => {
  const adoption = {
    adopt: vi.fn<ViewingAdoption['adopt']>(() => ADOPTED),
    hasLocalRows: vi.fn<ViewingAdoption['hasLocalRows']>(() => hasPast),
  }
  const accounts = new ViewingAccounts({ callerOf }, auth, { viewingOwner: () => owner }, adoption)
  return { accounts, adoption }
}

type KeyForProps = { caller: Caller; auth?: AuthConfig }

const keyFor = ({ caller, auth }: KeyForProps) =>
  accountsFor({ auth, callerOf: () => caller }).accounts.keyOf({ request: REQUEST })

describe('whose viewing a request reads and writes', () => {
  it('gives the browser of a server without accounts the one shared viewer', () => {
    expect(keyFor({ caller: { kind: CALLERS.legacy }, auth: OFF })).toBe(VIEWING_ACCOUNTS.local)
  })

  it('gives the browser of a server without accounts the owner who adopted the past', () => {
    const { accounts } = accountsFor({ auth: OFF, owner: OWNER.id })
    expect(accounts.keyOf({ request: REQUEST })).toBe(OWNER.id)
  })

  it('never gives a caller the account gate bound nothing to the owner while accounts are ready', () => {
    const { accounts } = accountsFor({ owner: OWNER.id })
    expect(accounts.keyOf({ request: REQUEST })).toBe(VIEWING_ACCOUNTS.local)
  })

  it('gives a session its account', () => {
    expect(keyFor({ caller: sessionOf(MEMBER) })).toBe(MEMBER.id)
  })

  it('gives a ticket the account it was minted for', () => {
    expect(keyFor({ caller: ticketOf(MEMBER) })).toBe(MEMBER.id)
  })

  it('asks the account gate about the request it is given', () => {
    const asked: object[] = []
    accountsFor({
      callerOf: ({ request }) => {
        asked.push(request)
        return { kind: CALLERS.legacy }
      },
    }).accounts.keyOf({ request: REQUEST })
    expect(asked).toHaveLength(1)
    expect(asked[0]).toBe(REQUEST)
  })
})

describe('the owner adopting the past', () => {
  it('waits for the owner while a member calls', () => {
    const { accounts, adoption } = accountsFor({ hasPast: true, callerOf: () => sessionOf(MEMBER) })
    expect(accounts.keyOf({ request: REQUEST })).toBe(MEMBER.id)
    expect(adoption.adopt).not.toHaveBeenCalled()
  })

  it.each([
    { how: 'session', callerOf: () => sessionOf(OWNER) },
    { how: 'ticket', callerOf: () => ticketOf(OWNER) },
  ])("adopts once, on the owner's first request by $how", ({ callerOf }) => {
    const { accounts, adoption } = accountsFor({ hasPast: true, callerOf })
    expect(accounts.keyOf({ request: REQUEST })).toBe(OWNER.id)
    expect(accounts.keyOf({ request: REQUEST })).toBe(OWNER.id)
    expect(adoption.adopt).toHaveBeenCalledTimes(1)
    expect(adoption.adopt).toHaveBeenCalledWith({ ownerId: OWNER.id })
  })

  it('logs how much it gave the owner, and nothing about who the owner is', () => {
    const logged = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
    try {
      accountsFor({ hasPast: true, callerOf: () => sessionOf(OWNER) }).accounts.keyOf({
        request: REQUEST,
      })
      expect(logged.mock.calls).toEqual([
        [
          'Gave the owner the viewing history from before accounts: 2 plays, 1 resume spots, 7 favourites',
        ],
      ])
    } finally {
      logged.mockRestore()
    }
  })

  it.each([MEMBER_STATUSES.pending, MEMBER_STATUSES.revoked])(
    'never adopts for an owner whose membership is %s',
    (status) => {
      const { accounts, adoption } = accountsFor({
        hasPast: true,
        callerOf: () => sessionOf({ ...OWNER, status }),
      })
      accounts.keyOf({ request: REQUEST })
      expect(adoption.adopt).not.toHaveBeenCalled()
    },
  )

  it('adopts nothing when no past is left', () => {
    const { accounts, adoption } = accountsFor({ callerOf: () => sessionOf(OWNER) })
    expect(accounts.keyOf({ request: REQUEST })).toBe(OWNER.id)
    expect(adoption.adopt).not.toHaveBeenCalled()
  })

  it('adopts nothing while accounts are off', () => {
    const { accounts, adoption } = accountsFor({
      auth: OFF,
      hasPast: true,
      callerOf: () => sessionOf(OWNER),
    })
    accounts.keyOf({ request: REQUEST })
    expect(adoption.hasLocalRows).not.toHaveBeenCalled()
    expect(adoption.adopt).not.toHaveBeenCalled()
  })

  /** A failure as better-sqlite3 throws it, its message naming the owner as a message could. */
  const failure = () =>
    Object.assign(new Error(`database or disk is full for ${OWNER.id}`), {
      code: SQLITE_CODES.full,
    })

  it('tries a failed adoption once per request, and again only after a pause', () => {
    vi.useFakeTimers({ now: 0 })
    try {
      const { accounts, adoption } = accountsFor({
        hasPast: true,
        callerOf: () => sessionOf(OWNER),
      })
      adoption.adopt.mockImplementationOnce(() => {
        throw failure()
      })
      const first = {}
      expect(accounts.keyOf({ request: first })).toBe(OWNER.id)
      expect(accounts.keyOf({ request: first })).toBe(OWNER.id)
      expect(adoption.adopt).toHaveBeenCalledTimes(1)

      vi.advanceTimersByTime(ADOPTION_RETRY_MS - 1)
      expect(accounts.keyOf({ request: {} })).toBe(OWNER.id)
      expect(adoption.adopt).toHaveBeenCalledTimes(1)

      vi.advanceTimersByTime(1)
      expect(accounts.keyOf({ request: {} })).toBe(OWNER.id)
      expect(accounts.keyOf({ request: {} })).toBe(OWNER.id)
      expect(adoption.adopt).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('logs only the SQLite code of a failed adoption, never its message', () => {
    const logged = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
    try {
      const { accounts, adoption } = accountsFor({
        hasPast: true,
        callerOf: () => sessionOf(OWNER),
      })
      adoption.adopt.mockImplementationOnce(() => {
        throw failure()
      })
      accounts.keyOf({ request: REQUEST })
      expect(logged.mock.calls).toEqual([
        [
          `Could not give the owner the viewing history from before accounts (SQLite code ${SQLITE_CODES.full}). Trying again in 60 s.`,
        ],
      ])
      expect(JSON.stringify(logged.mock.calls)).not.toContain(OWNER.id)
    } finally {
      logged.mockRestore()
    }
  })
})
