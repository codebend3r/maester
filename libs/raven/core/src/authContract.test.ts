import { describe, expect, it } from 'bun:test'
import {
  AUTH_CONFIG_STATES,
  AUTH_COOKIE,
  AUTH_REFUSALS,
  MEMBER_STATUSES,
  isAccount,
  isAuthConfig,
  isAuthRefusal,
  isMemberStatusChange,
} from '@/contract'

const account = {
  id: '30000000-0000-4000-8000-000000000001',
  email: 'member@maester.test',
  status: MEMBER_STATUSES.approved,
  isOwner: false,
} as const

describe('account contract boundaries', () => {
  it('accepts accounts only with known status, UUID identity and explicit ownership', () => {
    expect(isAccount(account)).toBe(true)
    expect(isAccount({ ...account, id: 'not-a-uuid' })).toBe(false)
    expect(isAccount({ ...account, status: 'invented-status' })).toBe(false)
    expect(isAccount({ ...account, isOwner: 'true' })).toBe(false)
    expect(isAccount({ ...account, isOwner: undefined })).toBe(false)
  })

  it('allows approval/removal but not an invented role or pending write', () => {
    expect(isMemberStatusChange({ status: MEMBER_STATUSES.approved })).toBe(true)
    expect(isMemberStatusChange({ status: MEMBER_STATUSES.revoked })).toBe(true)
    expect(isMemberStatusChange({ status: MEMBER_STATUSES.pending })).toBe(false)
    expect(isMemberStatusChange({ role: 'admin' })).toBe(false)
  })

  it('distinguishes public off/unavailable configuration from a configured client', () => {
    expect(isAuthConfig({ state: AUTH_CONFIG_STATES.off })).toBe(true)
    expect(isAuthConfig({ state: AUTH_CONFIG_STATES.unavailable })).toBe(true)
    const config = {
      state: AUTH_CONFIG_STATES.ready,
      supabaseUrl: 'https://auth.example.test',
      publishableKey: 'sb_publishable_test',
      webUrl: 'https://raven.example.test',
      cookieName: AUTH_COOKIE,
    }
    expect(isAuthConfig(config)).toBe(true)
    expect(isAuthConfig({ ...config, cookieName: 'unexpected-cookie' })).toBe(false)
    expect(isAuthConfig({ state: AUTH_CONFIG_STATES.ready })).toBe(false)
  })

  it('validates machine-readable refusals without accepting unknown reasons', () => {
    expect(isAuthRefusal({ reason: AUTH_REFUSALS.pending, message: 'Awaiting approval.' })).toBe(
      true,
    )
    expect(isAuthRefusal({ reason: 'invented-reason', message: 'No access.' })).toBe(false)
    expect(isAuthRefusal({ reason: AUTH_REFUSALS.signedOut })).toBe(false)
  })
})
