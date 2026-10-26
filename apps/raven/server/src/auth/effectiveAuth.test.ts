import { AUTH_CONFIG_STATES } from '@raven/core'
import { Logger } from '@nestjs/common'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { ACCOUNTS_OPT_OUT, AUTH_ENV } from '@/auth/authConfig'
import { ENFORCEMENT_RECORDS, effectiveAuth, resolveAuthState } from '@/auth/effectiveAuth'
import { readServerConfig } from '@/config'
import { SettingsRepository } from '@/settings/settingsRepository'
import { AUTH_TEST_CONFIG } from '@/test/auth'
import { testDatabase } from '@/test/database'

const OFF = { state: AUTH_CONFIG_STATES.off } as const
const UNAVAILABLE = { state: AUTH_CONFIG_STATES.unavailable } as const

describe('effectiveAuth', () => {
  it('is ready and marks the record when Supabase is configured', () => {
    expect(
      effectiveAuth({ configured: AUTH_TEST_CONFIG, hasEnforced: false, isOptedOut: false }),
    ).toEqual({ auth: AUTH_TEST_CONFIG, record: ENFORCEMENT_RECORDS.mark })
    expect(
      effectiveAuth({ configured: AUTH_TEST_CONFIG, hasEnforced: true, isOptedOut: false }),
    ).toEqual({ auth: AUTH_TEST_CONFIG, record: ENFORCEMENT_RECORDS.mark })
  })

  it('stays unavailable when the configuration is partial', () => {
    expect(
      effectiveAuth({ configured: UNAVAILABLE, hasEnforced: false, isOptedOut: false }),
    ).toEqual({ auth: UNAVAILABLE, record: ENFORCEMENT_RECORDS.keep })
    expect(
      effectiveAuth({ configured: UNAVAILABLE, hasEnforced: true, isOptedOut: false }),
    ).toEqual({ auth: UNAVAILABLE, record: ENFORCEMENT_RECORDS.keep })
  })

  it('reopens an unconfigured server only on the explicit opt-out, and forgets the record', () => {
    expect(effectiveAuth({ configured: OFF, hasEnforced: true, isOptedOut: true })).toEqual({
      auth: OFF,
      record: ENFORCEMENT_RECORDS.forget,
    })
    expect(effectiveAuth({ configured: OFF, hasEnforced: false, isOptedOut: true })).toEqual({
      auth: OFF,
      record: ENFORCEMENT_RECORDS.forget,
    })
  })

  it('fails closed when the server enforced accounts before and the configuration is gone', () => {
    expect(effectiveAuth({ configured: OFF, hasEnforced: true, isOptedOut: false })).toEqual({
      auth: UNAVAILABLE,
      record: ENFORCEMENT_RECORDS.keep,
    })
  })

  it('stays anonymous on a server that never enforced accounts', () => {
    expect(effectiveAuth({ configured: OFF, hasEnforced: false, isOptedOut: false })).toEqual({
      auth: OFF,
      record: ENFORCEMENT_RECORDS.keep,
    })
  })

  it('treats Supabase configuration together with the opt-out as a conflict and fails closed', () => {
    expect(
      effectiveAuth({ configured: AUTH_TEST_CONFIG, hasEnforced: false, isOptedOut: true }),
    ).toEqual({ auth: UNAVAILABLE, record: ENFORCEMENT_RECORDS.keep })
    expect(
      effectiveAuth({ configured: AUTH_TEST_CONFIG, hasEnforced: true, isOptedOut: true }),
    ).toEqual({ auth: UNAVAILABLE, record: ENFORCEMENT_RECORDS.keep })
    expect(effectiveAuth({ configured: UNAVAILABLE, hasEnforced: true, isOptedOut: true })).toEqual(
      { auth: UNAVAILABLE, record: ENFORCEMENT_RECORDS.keep },
    )
  })
})

describe('resolveAuthState', () => {
  const database = testDatabase('raven-auth-state-')
  const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
  const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)

  beforeAll(database.open)
  afterAll(database.close)
  afterEach(() => {
    warn.mockClear()
    error.mockClear()
    new SettingsRepository(database.get()).forgetAccountsEnforced()
  })

  type ResolveProps = {
    auth: typeof AUTH_TEST_CONFIG | typeof OFF
    isOptedOut: boolean
  }

  const resolve = ({ auth, isOptedOut }: ResolveProps) => {
    const settings = new SettingsRepository(database.get())
    return {
      settings,
      auth: resolveAuthState({
        config: { ...readServerConfig({}), auth, isAccountsOptedOut: isOptedOut },
        settings,
      }),
    }
  }

  it('records the first ready start and logs nothing', () => {
    const { settings, auth } = resolve({ auth: AUTH_TEST_CONFIG, isOptedOut: false })
    expect(auth).toEqual(AUTH_TEST_CONFIG)
    expect(settings.accountsEnforcedAt()).not.toBeNull()
    expect(warn).not.toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()
  })

  it('logs one error line when the record alone makes the server unavailable', () => {
    resolve({ auth: AUTH_TEST_CONFIG, isOptedOut: false })
    const { auth } = resolve({ auth: OFF, isOptedOut: false })
    expect(auth).toEqual(UNAVAILABLE)
    expect(error).toHaveBeenCalledTimes(1)
    expect(error).toHaveBeenCalledWith(expect.stringContaining(AUTH_ENV.accounts))
    expect(warn).not.toHaveBeenCalled()
  })

  it('warns on every start while the opt-out reopens the server, and forgets the record', () => {
    resolve({ auth: AUTH_TEST_CONFIG, isOptedOut: false })
    const first = resolve({ auth: OFF, isOptedOut: true })
    const second = resolve({ auth: OFF, isOptedOut: true })
    expect(first.auth).toEqual(OFF)
    expect(second.settings.accountsEnforcedAt()).toBeNull()
    expect(warn).toHaveBeenCalledTimes(2)
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(`${AUTH_ENV.accounts}=${ACCOUNTS_OPT_OUT}`),
    )
    expect(error).not.toHaveBeenCalled()
  })

  it('logs one error line for the opt-out together with Supabase settings and marks nothing', () => {
    const { settings, auth } = resolve({ auth: AUTH_TEST_CONFIG, isOptedOut: true })
    expect(auth).toEqual(UNAVAILABLE)
    expect(error).toHaveBeenCalledTimes(1)
    expect(warn).not.toHaveBeenCalled()
    expect(settings.accountsEnforcedAt()).toBeNull()
  })
})
