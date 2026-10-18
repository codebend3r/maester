import { describe, expect, it } from 'bun:test'
import {
  type AuthRefusal,
  ApiError,
  AUTH_CONFIG_STATES,
  AUTH_COOKIE,
  AUTH_REFUSALS,
  MEMBER_STATUSES,
} from '@raven/core'
import { ACCESS_KINDS, accessStateOf } from '@/lib/accessState'
import type { ReadyAuthConfig } from '@/lib/authClient'
import { AUTH_SESSION_STATUSES } from '@/stores/authSession'
import { fakeAccount } from '@/test/authClient'

const ready: ReadyAuthConfig = {
  state: AUTH_CONFIG_STATES.ready,
  supabaseUrl: 'http://127.0.0.1:54321',
  publishableKey: 'sb_publishable_test',
  webUrl: 'http://localhost:8484',
  cookieName: AUTH_COOKIE,
}

const known = { data: ready, error: null }
const unknown = { data: undefined, error: null }
const session = { status: AUTH_SESSION_STATUSES.ready, session: { accessToken: 't', userId: 'u' } }
const signedOut = { status: AUTH_SESSION_STATUSES.ready, session: null }
const booting = { status: AUTH_SESSION_STATUSES.booting, session: null }
const noAccount = { data: undefined, error: null }

const refused = ({ status, reason }: { status: number; reason: AuthRefusal['reason'] }) =>
  new ApiError({ status, message: 'refused', refusal: { reason, message: 'refused' } })

const refusal = (reason: AuthRefusal['reason']) => refused({ status: 403, reason })

describe('accessStateOf', () => {
  it('waits for the server to say whether accounts are on', () => {
    expect(accessStateOf({ config: unknown, session: booting, account: noAccount })).toEqual({
      kind: ACCESS_KINDS.loading,
    })
  })

  it('fails when the config cannot be read and nothing is known', () => {
    const config = { data: undefined, error: new Error('network') }
    expect(accessStateOf({ config, session: booting, account: noAccount })).toEqual({
      kind: ACCESS_KINDS.failed,
    })
  })

  it('is disabled when accounts are off, whatever else is known', () => {
    const config = { data: { state: AUTH_CONFIG_STATES.off }, error: null }
    expect(accessStateOf({ config, session: signedOut, account: noAccount })).toEqual({
      kind: ACCESS_KINDS.disabled,
    })
  })

  it('is unavailable when accounts are on but cannot be reached', () => {
    const config = { data: { state: AUTH_CONFIG_STATES.unavailable }, error: null }
    expect(accessStateOf({ config, session: signedOut, account: noAccount })).toEqual({
      kind: ACCESS_KINDS.unavailable,
    })
  })

  it('loads while the stored session is read', () => {
    expect(accessStateOf({ config: known, session: booting, account: noAccount })).toEqual({
      kind: ACCESS_KINDS.loading,
    })
  })

  it('is signed out without a session', () => {
    expect(accessStateOf({ config: known, session: signedOut, account: noAccount })).toEqual({
      kind: ACCESS_KINDS.signedOut,
    })
  })

  it('loads while the account is on its way', () => {
    expect(accessStateOf({ config: known, session, account: noAccount })).toEqual({
      kind: ACCESS_KINDS.loading,
    })
  })

  it('is approved with the account it read', () => {
    const account = fakeAccount()
    expect(
      accessStateOf({ config: known, session, account: { data: account, error: null } }),
    ).toEqual({
      kind: ACCESS_KINDS.approved,
      account,
    })
  })

  it('is pending for a pending membership and for a 403 pending refusal', () => {
    const pending = fakeAccount({ status: MEMBER_STATUSES.pending })
    expect(
      accessStateOf({ config: known, session, account: { data: pending, error: null } }),
    ).toEqual({
      kind: ACCESS_KINDS.pending,
    })
    const account = { data: undefined, error: refusal(AUTH_REFUSALS.pending) }
    expect(accessStateOf({ config: known, session, account })).toEqual({
      kind: ACCESS_KINDS.pending,
    })
  })

  it('is revoked for a removed membership and for a 403 revoked refusal', () => {
    const revoked = fakeAccount({ status: MEMBER_STATUSES.revoked })
    expect(
      accessStateOf({ config: known, session, account: { data: revoked, error: null } }),
    ).toEqual({
      kind: ACCESS_KINDS.revoked,
    })
    const account = { data: undefined, error: refusal(AUTH_REFUSALS.revoked) }
    expect(accessStateOf({ config: known, session, account })).toEqual({
      kind: ACCESS_KINDS.revoked,
    })
  })

  it('is signed out for a 401 signed_out refusal', () => {
    const account = {
      data: undefined,
      error: refused({ status: 401, reason: AUTH_REFUSALS.signedOut }),
    }
    expect(accessStateOf({ config: known, session, account })).toEqual({
      kind: ACCESS_KINDS.signedOut,
    })
  })

  it('fails on a 503 unavailable refusal, not a sign out', () => {
    const account = {
      data: undefined,
      error: refused({ status: 503, reason: AUTH_REFUSALS.unavailable }),
    }
    expect(accessStateOf({ config: known, session, account })).toEqual({
      kind: ACCESS_KINDS.failed,
    })
  })

  it('fails on a network error and on a refusal it cannot place', () => {
    expect(
      accessStateOf({
        config: known,
        session,
        account: { data: undefined, error: new TypeError('Failed to fetch') },
      }),
    ).toEqual({ kind: ACCESS_KINDS.failed })
    expect(
      accessStateOf({
        config: known,
        session,
        account: { data: undefined, error: refusal(AUTH_REFUSALS.notOwner) },
      }),
    ).toEqual({ kind: ACCESS_KINDS.failed })
    expect(
      accessStateOf({
        config: known,
        session,
        account: { data: undefined, error: new ApiError({ status: 500, message: 'boom' }) },
      }),
    ).toEqual({ kind: ACCESS_KINDS.failed })
  })

  it('keeps an approved account through a failed refresh of it, but not through a refusal', () => {
    const account = fakeAccount()
    expect(
      accessStateOf({
        config: known,
        session,
        account: { data: account, error: new TypeError('Failed to fetch') },
      }),
    ).toEqual({ kind: ACCESS_KINDS.approved, account })
    expect(
      accessStateOf({
        config: known,
        session,
        account: { data: account, error: refusal(AUTH_REFUSALS.revoked) },
      }),
    ).toEqual({ kind: ACCESS_KINDS.revoked })
  })
})
