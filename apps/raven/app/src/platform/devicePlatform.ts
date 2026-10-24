import { Platform } from 'react-native'

import { type AppPlatform, platformOf } from '@/platform/platform'

/** The platform this device is, whose table and rules plan what it plays. */
export const DEVICE_PLATFORM: AppPlatform = platformOf({ os: Platform.OS, isTV: Platform.isTV })
