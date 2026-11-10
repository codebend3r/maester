import { type Infer, isNumber, isString, object, oneOf, union } from '@/schema'

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
  object({ state: oneOf([DEVICE_DOWNLOAD_STATES.preparing]), progress: isNumber }),
  object({ state: oneOf([DEVICE_DOWNLOAD_STATES.ready]), bytes: isNumber }),
  object({ state: oneOf([DEVICE_DOWNLOAD_STATES.failed]), message: isString }),
)

export type DeviceDownload = Infer<typeof isDeviceDownload>
