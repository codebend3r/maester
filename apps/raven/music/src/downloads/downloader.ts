import { DISK_TRANSFERS, deviceDiskFor } from '@raven/native'

/**
 * The downloads' disk: `@raven/native`'s, each track's transcode prepared by a body-free HEAD
 * before the file comes in, since iOS's file downloader times out after 60 s.
 */
export const deviceDisk = deviceDiskFor({ transfer: DISK_TRANSFERS.prepared })
