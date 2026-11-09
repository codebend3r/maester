import { Platform } from 'react-native'

import { type AppPlatform, type NavKind, SYSTEMS, navKindOf, platformOf } from '@/platform/platform'

/** The platform this device is, whose table and rules plan what it plays. */
export const DEVICE_PLATFORM: AppPlatform = platformOf({ os: Platform.OS, isTV: Platform.isTV })

/** How this device moves between pages, read from the system's idiom, which only iOS reports. */
export const deviceNavKind = (): NavKind =>
  navKindOf({ isTV: Platform.isTV, isPad: Platform.OS === SYSTEMS.ios && Platform.isPad })
