import { resolve } from 'node:path'
import type { Anthropic } from '@anthropic-ai/sdk'
import { type AuthConfig, HW_ACCELS, type HwAccel, isHwAccel, oneOf } from '@raven/core'
import { ACCOUNTS_OPT_OUT, AUTH_ENV, readAuthConfig } from '@/auth/authConfig'
import { readMediaPlaneConfig, type MediaPlaneConfig } from '@/media/mediaPlaneConfig'
import { REQUEST_LOG_ENV } from '@/requestLog'
import { readRequestsConfig, type RequestsConfig } from '@/requests/requestsConfig'
import { readRemoteAccessConfig, type RemoteAccessConfig } from '@/remoteAccess/remoteAccessConfig'
import {
  atLeast,
  flag,
  type ListenConfig,
  readListenConfig,
  text,
  wholeNumber,
} from '@shared/server'

/** The effort levels the AI lookup can ask for, as `output_config.effort` takes them. */
const AI_MATCH_EFFORT_LEVELS = {
  low: 'low',
  medium: 'medium',
  high: 'high',
  xhigh: 'xhigh',
  max: 'max',
} as const satisfies Record<string, NonNullable<Anthropic.OutputConfig['effort']>>

const AI_MATCH_EFFORTS = Object.values(AI_MATCH_EFFORT_LEVELS)

/** Every environment variable raven's own config reads; listening, auth, the media plane, remote access and request logs name theirs beside their readers. */
export const RAVEN_ENV = {
  browseRoot: 'BROWSE_ROOT',
  ffmpegPath: 'FFMPEG_PATH',
  ffprobePath: 'FFPROBE_PATH',
  probeConcurrency: 'PROBE_CONCURRENCY',
  thumbnailConcurrency: 'THUMBNAIL_CONCURRENCY',
  ffmpegTimeoutSeconds: 'FFMPEG_TIMEOUT_SECONDS',
  keyframeProbeTimeoutSeconds: 'KEYFRAME_PROBE_TIMEOUT_SECONDS',
  thumbnailWidth: 'THUMBNAIL_WIDTH',
  markerDetection: 'MARKER_DETECTION',
  markerConcurrency: 'MARKER_CONCURRENCY',
  markerTimeoutSeconds: 'MARKER_TIMEOUT_SECONDS',
  scanOnStart: 'SCAN_ON_START',
  quickScanIntervalMinutes: 'QUICK_SCAN_INTERVAL_MINUTES',
  heroCount: 'HERO_COUNT',
  hwAccel: 'HW_ACCEL',
  vaapiDevice: 'VAAPI_DEVICE',
  tmdbApiToken: 'TMDB_API_TOKEN',
  metadataLanguage: 'METADATA_LANGUAGE',
  metadataCountry: 'METADATA_COUNTRY',
  omdbApiKey: 'OMDB_API_KEY',
  omdbDailyLimit: 'OMDB_DAILY_LIMIT',
  mdblistApiKey: 'MDBLIST_API_KEY',
  mdblistDailyLimit: 'MDBLIST_DAILY_LIMIT',
  anthropicApiKey: 'ANTHROPIC_API_KEY',
  aiMatchModel: 'AI_MATCH_MODEL',
  aiMatchEffort: 'AI_MATCH_EFFORT',
  aiDailyLimit: 'AI_DAILY_LIMIT',
  transcodeCacheGb: 'TRANSCODE_CACHE_GB',
  deviceDownloadCacheGb: 'DEVICE_DOWNLOAD_CACHE_GB',
  loudnessScan: 'LOUDNESS_SCAN',
  lastFmApiKey: 'LASTFM_API_KEY',
  lastFmApiSecret: 'LASTFM_API_SECRET',
  libraryPin: 'LIBRARY_PIN',
  adminPassword: 'ADMIN_PASSWORD',
} as const

/** GiB of MP4 copies for device downloads kept unless `DEVICE_DOWNLOAD_CACHE_GB` says otherwise. */
const DEVICE_DOWNLOAD_CACHE_GB = 300

/** raven's Last.fm API account, which signs every call it makes for an account. */
export type LastFmKeys = { apiKey: string; apiSecret: string }

/** Both Last.fm keys, or null while either is missing, which leaves Last.fm off. */
const lastFmKeysFrom = (env: NodeJS.ProcessEnv): LastFmKeys | null => {
  const apiKey = text({ value: env[RAVEN_ENV.lastFmApiKey], fallback: null })
  const apiSecret = text({ value: env[RAVEN_ENV.lastFmApiSecret], fallback: null })
  return apiKey === null || apiSecret === null ? null : { apiKey, apiSecret }
}

const GIB = 1024 ** 3

const isAiMatchEffort = oneOf(AI_MATCH_EFFORTS)

export type AiMatchEffort = (typeof AI_MATCH_EFFORT_LEVELS)[keyof typeof AI_MATCH_EFFORT_LEVELS]

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
  /** Whether seasons are listened to in the background for their intros; the admin can still turn it off. */
  markerDetection: boolean
  /** How many seasons are analysed at once. */
  markerConcurrency: number
  /**
   * How long one fingerprint or shot change run may take. It decodes up to
   * 15 minutes of a file, which on a 4K remux over a share reads gigabytes.
   */
  markerTimeoutSeconds: number
  /** Quick-scan every library on boot, picking up whatever changed while the server was down. */
  scanOnStart: boolean
  /** Check the libraries that refresh automatically but no watch hears of this often; 0 turns the timer off. */
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
  /** How many bytes of AAC transcodes of tracks are kept; the least recently served go first past it. */
  transcodeCacheBytes: number
  /**
   * How many bytes of MP4 copies made for devices that cannot play a video's original are
   * kept; the least recently served go first past it.
   */
  deviceDownloadCacheBytes: number
  /** Whether the tracks whose tags carry no ReplayGain are measured in the background for their loudness. */
  shouldScanLoudness: boolean
  /** Last.fm's API key and shared secret, for scrobbling; null keeps Last.fm off. Never logged or sent to a client. */
  lastFm: LastFmKeys | null
  /** The PIN that opens locked libraries; null leaves them shut and none can be locked. Never logged or sent to a client. */
  libraryPin: string | null
  /** The password that turns the admin lock off; null, or too weak, keeps it on. Never logged or sent to a client. */
  adminPassword: string | null
  /** Where the browser fetches media straight from the server, and who may ask: all off until configured. */
  mediaPlane: MediaPlaneConfig
  /** Where raven is checked from outside its network. */
  remoteAccess: RemoteAccessConfig
  /** Coming soon's requests: the Sonarr and Radarr they go to, the folders and the budget. */
  requests: RequestsConfig
  /** What the Supabase environment says. The state the server runs in also depends on its enforcement record, see `AUTH_STATE`. */
  auth: AuthConfig
  /** `RAVEN_ACCOUNTS=off` exactly: the operator's explicit rollback from enforced accounts. */
  isAccountsOptedOut: boolean
  /** Log a line for every request answered; off unless `RAVEN_LOG_REQUESTS` turns it on, which the dev script does. */
  shouldLogRequests: boolean
}

/** The DI token the config is provided under. */
export const SERVER_CONFIG = Symbol('SERVER_CONFIG')

/** An unknown or missing HW_ACCEL means `auto`. */
const hwAccelFrom = (value: string | undefined): HwAccel => {
  const trimmed = value?.trim() ?? ''
  return isHwAccel(trimmed) ? trimmed : HW_ACCELS.auto
}

/** An unknown or missing AI_MATCH_EFFORT means `low`. */
const aiEffortFrom = (value: string | undefined): AiMatchEffort => {
  const trimmed = value?.trim() ?? ''
  return isAiMatchEffort(trimmed) ? trimmed : AI_MATCH_EFFORT_LEVELS.low
}

export const readServerConfig = (env: NodeJS.ProcessEnv = process.env): ServerConfig => ({
  ...readListenConfig({ env, defaultPort: 8484 }),
  browseRoot: resolve(text({ value: env[RAVEN_ENV.browseRoot], fallback: '/' })),
  ffmpegPath: text({ value: env[RAVEN_ENV.ffmpegPath], fallback: 'ffmpeg' }),
  ffprobePath: text({ value: env[RAVEN_ENV.ffprobePath], fallback: 'ffprobe' }),
  probeConcurrency: atLeast({ value: env[RAVEN_ENV.probeConcurrency], min: 1, fallback: 4 }),
  thumbnailConcurrency: atLeast({
    value: env[RAVEN_ENV.thumbnailConcurrency],
    min: 1,
    fallback: 2,
  }),
  ffmpegTimeoutSeconds: atLeast({
    value: env[RAVEN_ENV.ffmpegTimeoutSeconds],
    min: 1,
    fallback: 90,
  }),
  keyframeProbeTimeoutSeconds: atLeast({
    value: env[RAVEN_ENV.keyframeProbeTimeoutSeconds],
    min: 1,
    fallback: 1800,
  }),
  thumbnailWidth: atLeast({ value: env[RAVEN_ENV.thumbnailWidth], min: 160, fallback: 480 }),
  markerDetection: flag({ value: env[RAVEN_ENV.markerDetection], fallback: true }),
  markerConcurrency: atLeast({ value: env[RAVEN_ENV.markerConcurrency], min: 1, fallback: 1 }),
  markerTimeoutSeconds: atLeast({
    value: env[RAVEN_ENV.markerTimeoutSeconds],
    min: 1,
    fallback: 900,
  }),
  scanOnStart: flag({ value: env[RAVEN_ENV.scanOnStart], fallback: true }),
  quickScanIntervalMinutes: wholeNumber(env[RAVEN_ENV.quickScanIntervalMinutes]) ?? 10,
  heroCount: atLeast({ value: env[RAVEN_ENV.heroCount], min: 1, fallback: 10 }),
  hwAccel: hwAccelFrom(env[RAVEN_ENV.hwAccel]),
  vaapiDevice: text({ value: env[RAVEN_ENV.vaapiDevice], fallback: '/dev/dri/renderD128' }),
  tmdbApiToken: text({ value: env[RAVEN_ENV.tmdbApiToken], fallback: null }),
  metadataLanguage: text({ value: env[RAVEN_ENV.metadataLanguage], fallback: 'en-US' }),
  metadataCountry: text({ value: env[RAVEN_ENV.metadataCountry], fallback: 'US' }).toUpperCase(),
  omdbApiKey: text({ value: env[RAVEN_ENV.omdbApiKey], fallback: null }),
  omdbDailyLimit: atLeast({ value: env[RAVEN_ENV.omdbDailyLimit], min: 1, fallback: 1000 }),
  mdblistApiKey: text({ value: env[RAVEN_ENV.mdblistApiKey], fallback: null }),
  mdblistDailyLimit: atLeast({ value: env[RAVEN_ENV.mdblistDailyLimit], min: 1, fallback: 1000 }),
  anthropicApiKey: text({ value: env[RAVEN_ENV.anthropicApiKey], fallback: null }),
  aiMatchModel: text({ value: env[RAVEN_ENV.aiMatchModel], fallback: 'claude-haiku-5-5' }),
  aiMatchEffort: aiEffortFrom(env[RAVEN_ENV.aiMatchEffort]),
  aiDailyLimit: atLeast({ value: env[RAVEN_ENV.aiDailyLimit], min: 1, fallback: 200 }),
  transcodeCacheBytes: (wholeNumber(env[RAVEN_ENV.transcodeCacheGb]) ?? 20) * GIB,
  deviceDownloadCacheBytes:
    (wholeNumber(env[RAVEN_ENV.deviceDownloadCacheGb]) ?? DEVICE_DOWNLOAD_CACHE_GB) * GIB,
  shouldScanLoudness: flag({ value: env[RAVEN_ENV.loudnessScan], fallback: true }),
  lastFm: lastFmKeysFrom(env),
  libraryPin: text({ value: env[RAVEN_ENV.libraryPin], fallback: null }),
  adminPassword: text({ value: env[RAVEN_ENV.adminPassword], fallback: null }),
  mediaPlane: readMediaPlaneConfig(env),
  remoteAccess: readRemoteAccessConfig(env),
  requests: readRequestsConfig(env),
  auth: readAuthConfig(env),
  isAccountsOptedOut: env[AUTH_ENV.accounts] === ACCOUNTS_OPT_OUT,
  shouldLogRequests: flag({ value: env[REQUEST_LOG_ENV.logRequests], fallback: false }),
})
