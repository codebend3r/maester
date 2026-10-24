import { Platform } from 'react-native'

import { canPlayFor } from '@/platform/canPlay'
import { platformOf } from '@/platform/platform'

/** What this device plays, for core's `planPlayback`: the table of the platform it runs on. */
export const DEVICE_SUPPORT = canPlayFor(platformOf({ os: Platform.OS, isTV: Platform.isTV }))
