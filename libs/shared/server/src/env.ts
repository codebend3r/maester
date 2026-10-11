import { resolve } from 'node:path'

/** A whole number at or above zero written as text, or null when it is not one (blank included). */
export const wholeNumber = (value: string | undefined): number | null => {
  const parsed = Number(value)
  return value != null && value.trim() !== '' && Number.isInteger(parsed) && parsed >= 0
    ? parsed
    : null
}

/** `1`, `true`, `yes` or `on` is true, their opposites false, and anything else `fallback`. */
export const flag = ({
  value,
  fallback,
}: {
  value: string | undefined
  fallback: boolean
}): boolean => {
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

/** `PORT`, `HOST`, `DATA_DIR` and `WEB_DIR`, with `defaultPort` when `PORT` is not a whole number. */
export const readListenConfig = ({
  env,
  defaultPort,
}: {
  env: NodeJS.ProcessEnv
  defaultPort: number
}): ListenConfig => ({
  port: wholeNumber(env.PORT) ?? defaultPort,
  host: env.HOST?.trim() || '0.0.0.0',
  dataDir: resolve(env.DATA_DIR?.trim() || './data'),
  webDir: env.WEB_DIR?.trim() ? resolve(env.WEB_DIR.trim()) : null,
})
