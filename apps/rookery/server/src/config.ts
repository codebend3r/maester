import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

/** Everything the server reads from its environment, resolved once at start. */
export type ServerConfig = {
  port: number
  host: string
  /** Holds the SQLite database; mount it as a volume under Docker. */
  dataDir: string
  /** The built web client to serve, or null when the Vite dev server serves it instead. */
  webDir: string | null
  /** rookery's own public origin, with no trailing slash. Plex sends the browser back here. */
  publicUrl: string
  /** The bearer token apps present to `/internal/session`. */
  serviceToken: string
  /** Origins `return_to` may point at besides rookery itself, e.g. luwin's. */
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

const REQUIRED = ['PUBLIC_URL', 'SERVICE_TOKEN'] as const

const wholeNumber = ({
  value,
  fallback,
}: {
  value: string | undefined
  fallback: number
}): number => {
  const parsed = Number(value)
  return value != null && value.trim() !== '' && Number.isInteger(parsed) && parsed >= 0
    ? parsed
    : fallback
}

const originOf = (value: string): string | null => {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : null
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
  const publicUrl = (env.PUBLIC_URL ?? '').trim().replace(/\/+$/, '')
  const appOrigins = list(env.APP_ORIGINS)
  const invalid = [
    ...(originOf(publicUrl) ? [] : [`PUBLIC_URL (${publicUrl})`]),
    ...appOrigins
      .filter((origin) => originOf(origin) == null)
      .map((origin) => `APP_ORIGINS (${origin})`),
  ]
  if (invalid.length > 0) {
    throw new ConfigError(`not an http(s) URL: ${invalid.join(', ')}`)
  }
  return {
    port: wholeNumber({ value: env.PORT, fallback: 8030 }),
    host: env.HOST?.trim() || '0.0.0.0',
    dataDir: resolve(env.DATA_DIR?.trim() || './data'),
    webDir: env.WEB_DIR?.trim() ? resolve(env.WEB_DIR.trim()) : null,
    publicUrl,
    serviceToken: (env.SERVICE_TOKEN ?? '').trim(),
    appOrigins: appOrigins.flatMap((origin) => originOf(origin) ?? []),
    cookieDomain: env.COOKIE_DOMAIN?.trim().replace(/^\./, '') || null,
    secureCookies: publicUrl.startsWith('https:'),
    pinCheckAttempts: 5,
    pinCheckDelayMs: 1000,
  }
}

/**
 * Reads `apps/rookery/.env`, beside the compose file, when `nest start` runs
 * outside Docker. What the process already has wins over the file, and the
 * image carries no such file.
 */
export const loadEnvFile = (path = resolve('..', '.env')): void => {
  if (existsSync(path)) process.loadEnvFile(path)
}
