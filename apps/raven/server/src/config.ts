import { resolve } from 'node:path'
import { type HwAccel, isHwAccel } from '@raven/core'
import { wholeNumber } from '@/wholeNumber'

/** Everything the server reads from its environment, resolved once at start. */
export type ServerConfig = {
  port: number
  host: string
  /** Holds the SQLite index and the thumbnail cache; mount it as a volume under Docker. */
  dataDir: string
  /** The built web client to serve, or null when the Vite dev server serves it instead. */
  webDir: string | null
  /** The folder picker never lists anything above this. */
  browseRoot: string
  ffmpegPath: string
  ffprobePath: string
  probeConcurrency: number
  thumbnailConcurrency: number
  /**
   * How long one ffprobe or thumbnail run may take. A busy NAS can take tens
   * of seconds to hand over the first bytes of a file; a run that times out
   * is retried on the next scan rather than marked as failed.
   */
  ffmpegTimeoutSeconds: number
  /** Thumbnail width in pixels; the height follows the aspect ratio. */
  thumbnailWidth: number
  /** Rescan every library on boot, picking up whatever changed while the server was down. */
  scanOnStart: boolean
  /** Rescan every library this often; 0 turns the timer off. */
  rescanIntervalMinutes: number
  /** How transcodes encode: `auto` tries the GPU this machine has, `none` keeps to the CPU. */
  hwAccel: HwAccel
  /** The VAAPI render node, passed into the container on a NAS with a GPU. */
  vaapiDevice: string
  /** TMDB's API Read Access Token, or its 32-character API key; null turns metadata off. Never logged or sent to a client. */
  tmdbApiToken: string | null
  /** The language titles and summaries come in, as TMDB spells it: `en-US`. */
  metadataLanguage: string
  /** Whose content rating and release date to show: `US`, `GB`. */
  metadataCountry: string
  /** OMDb's key, for IMDb, Rotten Tomatoes and Metacritic scores; null leaves them out. */
  omdbApiKey: string | null
  /** OMDb calls a day; a free key allows 1,000. */
  omdbDailyLimit: number
  /** The PIN that opens locked libraries; null leaves them shut and none can be locked. Never logged or sent to a client. */
  libraryPin: string | null
}

/** The DI token the config is provided under. */
export const SERVER_CONFIG = Symbol('SERVER_CONFIG')

const flag = ({ value, fallback }: { value: string | undefined; fallback: boolean }): boolean => {
  const normalised = value?.trim().toLowerCase() ?? ''
  if (['1', 'true', 'yes', 'on'].includes(normalised)) return true
  if (['0', 'false', 'no', 'off'].includes(normalised)) return false
  return fallback
}

/** An unknown or missing HW_ACCEL means `auto`. */
const hwAccelFrom = (value: string | undefined): HwAccel => {
  const trimmed = value?.trim() ?? ''
  return isHwAccel(trimmed) ? trimmed : 'auto'
}

export const readServerConfig = (env: NodeJS.ProcessEnv = process.env): ServerConfig => ({
  port: wholeNumber(env.PORT) ?? 8484,
  host: env.HOST?.trim() || '0.0.0.0',
  dataDir: resolve(env.DATA_DIR?.trim() || './data'),
  webDir: env.WEB_DIR?.trim() ? resolve(env.WEB_DIR.trim()) : null,
  browseRoot: resolve(env.BROWSE_ROOT?.trim() || '/'),
  ffmpegPath: env.FFMPEG_PATH?.trim() || 'ffmpeg',
  ffprobePath: env.FFPROBE_PATH?.trim() || 'ffprobe',
  probeConcurrency: Math.max(1, wholeNumber(env.PROBE_CONCURRENCY) ?? 4),
  thumbnailConcurrency: Math.max(1, wholeNumber(env.THUMBNAIL_CONCURRENCY) ?? 2),
  ffmpegTimeoutSeconds: Math.max(1, wholeNumber(env.FFMPEG_TIMEOUT_SECONDS) ?? 90),
  thumbnailWidth: Math.max(160, wholeNumber(env.THUMBNAIL_WIDTH) ?? 480),
  scanOnStart: flag({ value: env.SCAN_ON_START, fallback: true }),
  rescanIntervalMinutes: wholeNumber(env.RESCAN_INTERVAL_MINUTES) ?? 0,
  hwAccel: hwAccelFrom(env.HW_ACCEL),
  vaapiDevice: env.VAAPI_DEVICE?.trim() || '/dev/dri/renderD128',
  tmdbApiToken: env.TMDB_API_TOKEN?.trim() || null,
  metadataLanguage: env.METADATA_LANGUAGE?.trim() || 'en-US',
  metadataCountry: (env.METADATA_COUNTRY?.trim() || 'US').toUpperCase(),
  omdbApiKey: env.OMDB_API_KEY?.trim() || null,
  omdbDailyLimit: Math.max(1, wholeNumber(env.OMDB_DAILY_LIMIT) ?? 1000),
  libraryPin: env.LIBRARY_PIN?.trim() || null,
})
