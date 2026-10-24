import { resolve } from 'node:path'
import type { Anthropic } from '@anthropic-ai/sdk'
import { type AuthConfig, type HwAccel, isHwAccel, oneOf } from '@raven/core'
import { ACCOUNTS_OPT_OUT, AUTH_ENV, readAuthConfig } from '@/auth/authConfig'
import { readMediaPlaneConfig, type MediaPlaneConfig } from '@/media/mediaPlaneConfig'
import { flag, type ListenConfig, readListenConfig, wholeNumber } from '@shared/server'

/** The effort levels the AI lookup can ask for, as `output_config.effort` takes them. */
const AI_MATCH_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const satisfies ReadonlyArray<
  NonNullable<Anthropic.OutputConfig['effort']>
>

const isAiMatchEffort = oneOf(AI_MATCH_EFFORTS)

export type AiMatchEffort = (typeof AI_MATCH_EFFORTS)[number]

/**
 * Everything the server reads from its environment, resolved once at start.
 * `dataDir` holds the SQLite index and the thumbnail cache.
 */
export type ServerConfig = ListenConfig & {
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
  /**
   * How long the keyframe probe may take. It lists every video packet, so it
   * reads the whole file: minutes for a remux of tens of gigabytes over a
   * share, far past what a header probe needs.
   */
  keyframeProbeTimeoutSeconds: number
  /** Thumbnail width in pixels; the height follows the aspect ratio. */
  thumbnailWidth: number
  /** Quick-scan every library on boot, picking up whatever changed while the server was down. */
  scanOnStart: boolean
  /** Quick-scan every library that refreshes automatically this often; 0 turns the timer off. */
  quickScanIntervalMinutes: number
  /** How many titles home's hero holds at most, picked by the admin or by release date; at least 1. */
  heroCount: number
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
  /** MDBList's key, for Rotten Tomatoes and Metacritic scores of shows too; null leaves it out. Never logged or sent to a client. */
  mdblistApiKey: string | null
  /** MDBList calls a day; a free key allows 1,000. */
  mdblistDailyLimit: number
  /** raven's own Anthropic key, for the AI lookup of what matching leaves; null turns it off. Never logged or sent to a client. */
  anthropicApiKey: string | null
  /** The model the AI lookup asks: `claude-haiku-5-5`. */
  aiMatchModel: string
  /** How hard it thinks, as `output_config.effort`; the spike found `low` enough. */
  aiMatchEffort: AiMatchEffort
  /** AI lookups a day, counted again from midnight UTC. */
  aiDailyLimit: number
  /** The PIN that opens locked libraries; null leaves them shut and none can be locked. Never logged or sent to a client. */
  libraryPin: string | null
  /** The password that turns the admin lock off; null, or too weak, keeps it on. Never logged or sent to a client. */
  adminPassword: string | null
  /** Where the browser fetches media straight from the server, and who may ask: all off until configured. */
  mediaPlane: MediaPlaneConfig
  /** What the Supabase environment says. The state the server runs in also depends on its enforcement record, see `AUTH_STATE`. */
  auth: AuthConfig
  /** `RAVEN_ACCOUNTS=off` exactly: the operator's explicit rollback from enforced accounts. */
  isAccountsOptedOut: boolean
}

/** The DI token the config is provided under. */
export const SERVER_CONFIG = Symbol('SERVER_CONFIG')

/** An unknown or missing HW_ACCEL means `auto`. */
const hwAccelFrom = (value: string | undefined): HwAccel => {
  const trimmed = value?.trim() ?? ''
  return isHwAccel(trimmed) ? trimmed : 'auto'
}

/** An unknown or missing AI_MATCH_EFFORT means `low`. */
const aiEffortFrom = (value: string | undefined): AiMatchEffort => {
  const trimmed = value?.trim() ?? ''
  return isAiMatchEffort(trimmed) ? trimmed : 'low'
}

export const readServerConfig = (env: NodeJS.ProcessEnv = process.env): ServerConfig => ({
  ...readListenConfig({ env, defaultPort: 8484 }),
  browseRoot: resolve(env.BROWSE_ROOT?.trim() || '/'),
  ffmpegPath: env.FFMPEG_PATH?.trim() || 'ffmpeg',
  ffprobePath: env.FFPROBE_PATH?.trim() || 'ffprobe',
  probeConcurrency: Math.max(1, wholeNumber(env.PROBE_CONCURRENCY) ?? 4),
  thumbnailConcurrency: Math.max(1, wholeNumber(env.THUMBNAIL_CONCURRENCY) ?? 2),
  ffmpegTimeoutSeconds: Math.max(1, wholeNumber(env.FFMPEG_TIMEOUT_SECONDS) ?? 90),
  keyframeProbeTimeoutSeconds: Math.max(1, wholeNumber(env.KEYFRAME_PROBE_TIMEOUT_SECONDS) ?? 1800),
  thumbnailWidth: Math.max(160, wholeNumber(env.THUMBNAIL_WIDTH) ?? 480),
  scanOnStart: flag({ value: env.SCAN_ON_START, fallback: true }),
  quickScanIntervalMinutes: wholeNumber(env.QUICK_SCAN_INTERVAL_MINUTES) ?? 10,
  heroCount: Math.max(1, wholeNumber(env.HERO_COUNT) ?? 10),
  hwAccel: hwAccelFrom(env.HW_ACCEL),
  vaapiDevice: env.VAAPI_DEVICE?.trim() || '/dev/dri/renderD128',
  tmdbApiToken: env.TMDB_API_TOKEN?.trim() || null,
  metadataLanguage: env.METADATA_LANGUAGE?.trim() || 'en-US',
  metadataCountry: (env.METADATA_COUNTRY?.trim() || 'US').toUpperCase(),
  omdbApiKey: env.OMDB_API_KEY?.trim() || null,
  omdbDailyLimit: Math.max(1, wholeNumber(env.OMDB_DAILY_LIMIT) ?? 1000),
  mdblistApiKey: env.MDBLIST_API_KEY?.trim() || null,
  mdblistDailyLimit: Math.max(1, wholeNumber(env.MDBLIST_DAILY_LIMIT) ?? 1000),
  anthropicApiKey: env.ANTHROPIC_API_KEY?.trim() || null,
  aiMatchModel: env.AI_MATCH_MODEL?.trim() || 'claude-haiku-5-5',
  aiMatchEffort: aiEffortFrom(env.AI_MATCH_EFFORT),
  aiDailyLimit: Math.max(1, wholeNumber(env.AI_DAILY_LIMIT) ?? 200),
  libraryPin: env.LIBRARY_PIN?.trim() || null,
  adminPassword: env.ADMIN_PASSWORD?.trim() || null,
  mediaPlane: readMediaPlaneConfig(env),
  auth: readAuthConfig(env),
  isAccountsOptedOut: env[AUTH_ENV.accounts] === ACCOUNTS_OPT_OUT,
})
