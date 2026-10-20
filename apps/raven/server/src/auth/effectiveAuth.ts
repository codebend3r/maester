import { Logger } from '@nestjs/common'
import { AUTH_CONFIG_STATES, type AuthConfig } from '@raven/core'
import { AUTH_ENV, ACCOUNTS_OPT_OUT } from '@/auth/authConfig'
import { type ServerConfig } from '@/config'
import { SettingsRepository } from '@/settings/settingsRepository'

/** The DI token the effective auth state is provided under: what every auth reader asks, never `config.auth`. */
export const AUTH_STATE = Symbol('AUTH_STATE')

export const ENFORCEMENT_RECORDS = { keep: 'keep', mark: 'mark', forget: 'forget' } as const
export type EnforcementRecord = (typeof ENFORCEMENT_RECORDS)[keyof typeof ENFORCEMENT_RECORDS]

const UNAVAILABLE: AuthConfig = { state: AUTH_CONFIG_STATES.unavailable }

/**
 * The auth state the server runs in, and what to do with its enforcement
 * record. A server that once enforced accounts never falls back to anonymous
 * access by itself: only the operator's explicit opt-out reopens it.
 */
export const effectiveAuth = ({
  configured,
  hasEnforced,
  isOptedOut,
}: {
  configured: AuthConfig
  hasEnforced: boolean
  isOptedOut: boolean
}): { auth: AuthConfig; record: EnforcementRecord } => {
  const failClosed = { auth: UNAVAILABLE, record: ENFORCEMENT_RECORDS.keep }
  switch (configured.state) {
    case AUTH_CONFIG_STATES.ready:
      return isOptedOut ? failClosed : { auth: configured, record: ENFORCEMENT_RECORDS.mark }
    case AUTH_CONFIG_STATES.unavailable:
      return failClosed
    case AUTH_CONFIG_STATES.off:
      if (isOptedOut) return { auth: configured, record: ENFORCEMENT_RECORDS.forget }
      return hasEnforced ? failClosed : { auth: configured, record: ENFORCEMENT_RECORDS.keep }
    default: {
      const unreachable: never = configured
      throw new Error(`Unknown auth state: ${JSON.stringify(unreachable)}`)
    }
  }
}

const logger = new Logger(effectiveAuth.name)

/** Applies `effectiveAuth` to the config and the stored record at start, and says why when it fails closed. */
export const resolveAuthState = ({
  config,
  settings,
}: {
  config: ServerConfig
  settings: SettingsRepository
}): AuthConfig => {
  const hasEnforced = settings.accountsEnforcedAt() !== null
  const { auth, record } = effectiveAuth({
    configured: config.auth,
    hasEnforced,
    isOptedOut: config.isAccountsOptedOut,
  })
  switch (record) {
    case ENFORCEMENT_RECORDS.mark:
      settings.markAccountsEnforced({ at: new Date() })
      break
    case ENFORCEMENT_RECORDS.forget:
      settings.forgetAccountsEnforced()
      break
    case ENFORCEMENT_RECORDS.keep:
      break
    default: {
      const unreachable: never = record
      throw new Error(`Unknown enforcement record: ${String(unreachable)}`)
    }
  }
  if (config.isAccountsOptedOut && auth.state === AUTH_CONFIG_STATES.off) {
    logger.warn(
      `${AUTH_ENV.accounts}=${ACCOUNTS_OPT_OUT} is set: raven is open to anonymous viewers. Unset it once accounts are meant to be enforced.`,
    )
  }
  if (config.isAccountsOptedOut && config.auth.state !== AUTH_CONFIG_STATES.off) {
    logger.error(
      `${AUTH_ENV.accounts}=${ACCOUNTS_OPT_OUT} conflicts with the Supabase settings. Remove one of them. Every protected route answers unavailable until then.`,
    )
    return auth
  }
  if (
    auth.state === AUTH_CONFIG_STATES.unavailable &&
    config.auth.state === AUTH_CONFIG_STATES.off
  ) {
    logger.error(
      `This server enforced accounts before and its Supabase settings are gone. Every protected route answers unavailable. Restore them, or set ${AUTH_ENV.accounts}=${ACCOUNTS_OPT_OUT} to reopen raven to anonymous viewers.`,
    )
  }
  return auth
}
