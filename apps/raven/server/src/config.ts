import { resolve } from 'node:path'
import { type HwAccel, isHwAccel } from '@/ffmpeg/encoder'

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
}

/** The DI token the config is provided under. */
export const SERVER_CONFIG = Symbol('SERVER_CONFIG')

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
  port: wholeNumber({ value: env.PORT, fallback: 8484 }),
  host: env.HOST?.trim() || '0.0.0.0',
  dataDir: resolve(env.DATA_DIR?.trim() || './data'),
  webDir: env.WEB_DIR?.trim() ? resolve(env.WEB_DIR.trim()) : null,
  browseRoot: resolve(env.BROWSE_ROOT?.trim() || '/'),
  ffmpegPath: env.FFMPEG_PATH?.trim() || 'ffmpeg',
  ffprobePath: env.FFPROBE_PATH?.trim() || 'ffprobe',
  probeConcurrency: Math.max(1, wholeNumber({ value: env.PROBE_CONCURRENCY, fallback: 4 })),
  thumbnailConcurrency: Math.max(1, wholeNumber({ value: env.THUMBNAIL_CONCURRENCY, fallback: 2 })),
  ffmpegTimeoutSeconds: Math.max(
    1,
    wholeNumber({ value: env.FFMPEG_TIMEOUT_SECONDS, fallback: 90 }),
  ),
  thumbnailWidth: Math.max(160, wholeNumber({ value: env.THUMBNAIL_WIDTH, fallback: 480 })),
  scanOnStart: flag({ value: env.SCAN_ON_START, fallback: true }),
  rescanIntervalMinutes: wholeNumber({ value: env.RESCAN_INTERVAL_MINUTES, fallback: 0 }),
  hwAccel: hwAccelFrom(env.HW_ACCEL),
  vaapiDevice: env.VAAPI_DEVICE?.trim() || '/dev/dri/renderD128',
})
