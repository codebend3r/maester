import { type Infer, isNumber, isString, object, oneOf, union, literal } from '@/schema'

/**
 * The routes a device downloads a video through when its player cannot open the original
 * file (an MKV on an iPad): `prepare` asks the server to remux the video into an MP4 the
 * device plays, and says how far along that copy is; `file` serves the finished copy with
 * byte ranges, opened by a media ticket as `file` serves the original.
 */
export const DEVICE_DOWNLOAD_PATHS = {
  prepare: '/api/media/:id/device-download',
  file: '/api/media/:id/device-download/file',
} as const

/** The placeholders `DEVICE_DOWNLOAD_PATHS` name. */
export const DEVICE_DOWNLOAD_PARAMS = { id: 'id' } as const

/**
 * The copies the server makes of a video. `copy` keeps the picture as it is, for a player
 * that decodes it but cannot open the container (an MKV on an iPad). `sdr` encodes it again
 * as 8-bit H.264 in BT.709 with AAC stereo sound, which every browser plays offline: HDR is
 * tone mapped. Dolby Vision profile 5 has no `sdr` copy, and asking for one fails.
 */
export const DEVICE_DOWNLOAD_VARIANTS = { copy: 'copy', sdr: 'sdr' } as const

export const isDeviceDownloadVariant = oneOf(Object.values(DEVICE_DOWNLOAD_VARIANTS))

export type DeviceDownloadVariant = Infer<typeof isDeviceDownloadVariant>

/** The query parameter both routes take to name the copy; without it the copy is `copy`. */
export const DEVICE_DOWNLOAD_VARIANT_PARAM = 'variant'

/** The copy a client that names none gets, as the apps shipped before `sdr` ask. */
export const DEFAULT_DEVICE_DOWNLOAD_VARIANT = DEVICE_DOWNLOAD_VARIANTS.copy

/** Where the server's MP4 copy of a video stands. */
export const DEVICE_DOWNLOAD_STATES = {
  preparing: 'preparing',
  ready: 'ready',
  failed: 'failed',
} as const

/**
 * `GET DEVICE_DOWNLOAD_PATHS.prepare`'s answer. Asking starts the copy when none is cached
 * or running. `progress` is from 0 to 1; `bytes` is the finished copy's size.
 */
export const isDeviceDownload = union(
  object({ state: literal(DEVICE_DOWNLOAD_STATES.preparing), progress: isNumber }),
  object({ state: literal(DEVICE_DOWNLOAD_STATES.ready), bytes: isNumber }),
  object({ state: literal(DEVICE_DOWNLOAD_STATES.failed), message: isString }),
)

export type DeviceDownload = Infer<typeof isDeviceDownload>
