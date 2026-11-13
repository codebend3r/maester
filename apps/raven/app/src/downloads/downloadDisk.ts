import { DISK_TRANSFERS, deviceDiskFor } from '@raven/native'

/**
 * The downloads' disk: `@raven/native`'s, each file through a download task in the app's own
 * session, cancelled by its signal and read as it comes in.
 */
export const deviceDisk = deviceDiskFor({ transfer: DISK_TRANSFERS.task })
