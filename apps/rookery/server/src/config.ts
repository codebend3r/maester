import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { type ListenConfig, readListenConfig } from '@shared/server'

/** Everything the server reads from its environment, resolved once at start. */
export type ServerConfig = ListenConfig & {
  /** rookery's own public origin, with no trailing slash. Plex sends the browser back here. */
  publicUrl: string
  /** The bearer token apps present to `/internal/session`. */
  serviceToken: string
  /** Origins `return_to` may point at besides rookery itself, e.g. sparrow's. */
  appOrigins: readonly string[]
  /** The parent domain the session cookie is shared across, or null to keep it on this host. */
  cookieDomain: string | null
  /** Cookies are Secure whenever rookery is served over https. */
  secureCookies: boolean
  /** How many times the callback asks plex.tv for the PIN's token, since it can trail the redirect. */
  pinCheckAttempts: number
  pinCheckDelayMs: number
}

/** The DI token the config is provided under. */
export const SERVER_CONFIG = Symbol('SERVER_CONFIG')

/** Raised naming every required variable the environment lacks, or every one it holds badly. */
export class ConfigError extends Error {}

/** What rookery reads itself; `readListenConfig` reads the `LISTEN_ENV_VARS`. */
export const ENV_VARS = {
  publicUrl: 'PUBLIC_URL',
  serviceToken: 'SERVICE_TOKEN',
  appOrigins: 'APP_ORIGINS',
  cookieDomain: 'COOKIE_DOMAIN',
} as const

const REQUIRED = [ENV_VARS.publicUrl, ENV_VARS.serviceToken] as const

const PROTOCOLS = { http: 'http:', https: 'https:' } as const

const originOf = (value: string): string | null => {
  try {
    const url = new URL(value)
    return url.protocol === PROTOCOLS.http || url.protocol === PROTOCOLS.https ? url.origin : null
  } catch {
    return null
  }
}

const list = (value: string | undefined): string[] =>
  (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)

export const readServerConfig = (env: NodeJS.ProcessEnv = process.env): ServerConfig => {
  const missing = REQUIRED.filter((name) => !env[name]?.trim())
  if (missing.length > 0) {
    throw new ConfigError(`missing required environment: ${missing.join(', ')}`)
  }
  const publicUrl = (env[ENV_VARS.publicUrl] ?? '').trim().replace(/\/+$/, '')
  const appOrigins = list(env[ENV_VARS.appOrigins])
  const invalid = [
    ...(originOf(publicUrl) ? [] : [`${ENV_VARS.publicUrl} (${publicUrl})`]),
    ...appOrigins
      .filter((origin) => originOf(origin) == null)
      .map((origin) => `${ENV_VARS.appOrigins} (${origin})`),
  ]
  if (invalid.length > 0) {
    throw new ConfigError(`not an http(s) URL: ${invalid.join(', ')}`)
  }
  return {
    ...readListenConfig({ env, defaultPort: 8030 }),
    publicUrl,
    serviceToken: (env[ENV_VARS.serviceToken] ?? '').trim(),
    appOrigins: appOrigins.flatMap((origin) => originOf(origin) ?? []),
    cookieDomain: env[ENV_VARS.cookieDomain]?.trim().replace(/^\./, '') || null,
    secureCookies: publicUrl.startsWith(PROTOCOLS.https),
    pinCheckAttempts: 5,
    pinCheckDelayMs: 1000,
  }
}

/**
 * Reads `apps/rookery/.env`, beside the compose file, when the server runs
 * outside Docker. What the process already has wins over the file, and the
 * image carries no such file.
 */
export const loadEnvFile = (path = resolve('..', '.env')): void => {
  if (existsSync(path)) process.loadEnvFile(path)
}
