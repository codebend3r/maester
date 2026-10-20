import {
  AUTH_CONFIG_STATES,
  AUTH_HEADERS,
  MEMBER_STATUSES,
  type Account,
  type AuthConfig,
} from '@raven/core'
import { describe, expect, it } from 'vitest'
import { ADMIN_COOKIE } from '@/admin/adminService'
import { CALLERS, type Caller } from '@/auth/authSessions'
import { Management } from '@/auth/management'
import { AUTH_TEST_CONFIG, AUTH_TEST_IDS } from '@/test/auth'

const OWNER: Account = {
  id: AUTH_TEST_IDS.owner,
  email: 'owner@maester.test',
  status: MEMBER_STATUSES.approved,
  isOwner: true,
}
const MEMBER: Account = { ...OWNER, id: AUTH_TEST_IDS.friend, isOwner: false }
const REMOVED_OWNER: Account = { ...OWNER, status: MEMBER_STATUSES.revoked }

const TOKEN = { token: 'jwt', expiresAt: 1 } as const

const sessionOf = (account: Account): Caller => ({
  kind: CALLERS.session,
  session: { account, ...TOKEN },
  isBearer: true,
})

const ticketOf = (account: Account): Caller => ({
  kind: CALLERS.ticket,
  session: { account, ...TOKEN },
  unlockedUntil: null,
})

const LEGACY: Caller = { kind: CALLERS.legacy }

const COOKIE_SENT = `${ADMIN_COOKIE}=anything`
const REQUEST = { headers: { [AUTH_HEADERS.cookie]: COOKIE_SENT } }
const REQUEST_WITHOUT_COOKIE = { headers: {} }

const managementWith = ({
  auth,
  caller,
  isAdminLocked = true,
}: {
  auth: AuthConfig
  caller: Caller
  isAdminLocked?: boolean
}) => new Management(auth, { isLocked: () => isAdminLocked }, { callerOf: () => caller })

describe('who can manage raven', () => {
  it('follows the admin lock when accounts are off', () => {
    const off = { state: AUTH_CONFIG_STATES.off } as const
    expect(managementWith({ auth: off, caller: LEGACY }).canManage({ request: REQUEST })).toBe(
      false,
    )
    expect(
      managementWith({ auth: off, caller: LEGACY, isAdminLocked: false }).canManage({
        request: REQUEST,
      }),
    ).toBe(true)
  })

  it('reads the cookie the request carries for the admin lock', () => {
    const seen: (string | undefined)[] = []
    const management = new Management(
      { state: AUTH_CONFIG_STATES.off },
      {
        isLocked: ({ cookie }) => {
          seen.push(cookie)
          return false
        },
      },
      { callerOf: () => LEGACY },
    )
    management.canManage({ request: REQUEST })
    management.canManage({ request: REQUEST_WITHOUT_COOKIE })
    expect(seen).toEqual([COOKIE_SENT, undefined])
  })

  it('gives management to the owner alone once accounts are ready', () => {
    const outcomes = [
      sessionOf(OWNER),
      ticketOf(OWNER),
      sessionOf(MEMBER),
      ticketOf(MEMBER),
      sessionOf(REMOVED_OWNER),
    ].map((caller) =>
      managementWith({ auth: AUTH_TEST_CONFIG, caller }).canManage({ request: REQUEST }),
    )
    expect(outcomes).toEqual([true, true, false, false, false])
  })

  it('never treats a request that skipped binding as the legacy browser when ready', () => {
    const management = managementWith({
      auth: AUTH_TEST_CONFIG,
      caller: LEGACY,
      isAdminLocked: false,
    })
    expect(management.canManage({ request: REQUEST })).toBe(false)
  })

  it('lets no one manage when accounts are unavailable', () => {
    const management = managementWith({
      auth: { state: AUTH_CONFIG_STATES.unavailable },
      caller: sessionOf(OWNER),
      isAdminLocked: false,
    })
    expect(management.canManage({ request: REQUEST })).toBe(false)
  })

  it('is legacy only while accounts are off', () => {
    const states: AuthConfig[] = [
      { state: AUTH_CONFIG_STATES.off },
      { state: AUTH_CONFIG_STATES.unavailable },
      AUTH_TEST_CONFIG,
    ]
    expect(states.map((auth) => managementWith({ auth, caller: LEGACY }).isLegacy())).toEqual([
      true,
      false,
      false,
    ])
  })
})
