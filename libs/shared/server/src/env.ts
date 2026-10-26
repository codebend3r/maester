import { resolve } from 'node:path'

/** A whole number at or above zero written as text, or null when it is not one (blank included). */
export const wholeNumber = (value: string | undefined): number | null => {
  const parsed = Number(value)
  return value != null && value.trim() !== '' && Number.isInteger(parsed) && parsed >= 0
    ? parsed
    : null
}

type FlagProps = {
  value: string | undefined
  fallback: boolean
}

/** `1`, `true`, `yes` or `on` is true, their opposites false, and anything else `fallback`. */
export const flag = ({ value, fallback }: FlagProps): boolean => {
  const normalised = value?.trim().toLowerCase() ?? ''
  if (['1', 'true', 'yes', 'on'].includes(normalised)) return true
  if (['0', 'false', 'no', 'off'].includes(normalised)) return false
  return fallback
}

/** Where a server listens and what it keeps where, as every product reads it. */
export type ListenConfig = {
  port: number
  host: string
  /** Holds the SQLite database and whatever else the server keeps; mount it as a volume under Docker. */
  dataDir: string
  /** The built web client to serve, or null when the Vite dev server serves it instead. */
  webDir: string | null
}

export const LISTEN_ENV_VARS = {
  port: 'PORT',
  host: 'HOST',
  dataDir: 'DATA_DIR',
  webDir: 'WEB_DIR',
} as const

type ReadListenConfigProps = {
  env: NodeJS.ProcessEnv
  defaultPort: number
}

/** `PORT`, `HOST`, `DATA_DIR` and `WEB_DIR`, with `defaultPort` when `PORT` is not a whole number. */
export const readListenConfig = ({ env, defaultPort }: ReadListenConfigProps): ListenConfig => {
  const webDir = env[LISTEN_ENV_VARS.webDir]?.trim()
  return {
    port: wholeNumber(env[LISTEN_ENV_VARS.port]) ?? defaultPort,
    host: env[LISTEN_ENV_VARS.host]?.trim() || '0.0.0.0',
    dataDir: resolve(env[LISTEN_ENV_VARS.dataDir]?.trim() || './data'),
    webDir: webDir ? resolve(webDir) : null,
  }
}
