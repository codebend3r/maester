import { resolve } from 'node:path'

/** A whole number at or above zero written as text, or null when it is not one (blank included). */
export const wholeNumber = (value: string | undefined): number | null => {
  const parsed = Number(value)
  return value != null && value.trim() !== '' && Number.isInteger(parsed) && parsed >= 0
    ? parsed
    : null
}

type TextProps<F extends string | null> = {
  value: string | undefined
  fallback: F
}

/** The value trimmed, or `fallback` when it is missing or blank. */
export const text = <F extends string | null>({ value, fallback }: TextProps<F>): string | F => {
  const trimmed = value?.trim() ?? ''
  return trimmed === '' ? fallback : trimmed
}

type AtLeastProps = {
  value: string | undefined
  min: number
  fallback: number
}

/** A whole number read as `wholeNumber` reads it, `fallback` when it is not one, and never below `min`. */
export const atLeast = ({ value, min, fallback }: AtLeastProps): number =>
  Math.max(min, wholeNumber(value) ?? fallback)

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

const LISTEN_DEFAULTS = { host: '0.0.0.0', dataDir: './data' } as const

/** `PORT`, `HOST`, `DATA_DIR` and `WEB_DIR`, with `defaultPort` when `PORT` is not a whole number. */
export const readListenConfig = ({ env, defaultPort }: ReadListenConfigProps): ListenConfig => {
  const webDir = text({ value: env[LISTEN_ENV_VARS.webDir], fallback: null })
  return {
    port: wholeNumber(env[LISTEN_ENV_VARS.port]) ?? defaultPort,
    host: text({ value: env[LISTEN_ENV_VARS.host], fallback: LISTEN_DEFAULTS.host }),
    dataDir: resolve(
      text({ value: env[LISTEN_ENV_VARS.dataDir], fallback: LISTEN_DEFAULTS.dataDir }),
    ),
    webDir: webDir === null ? null : resolve(webDir),
  }
}
