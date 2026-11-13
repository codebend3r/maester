import { Platform } from 'react-native'

import {
  type AppPlatform,
  type NavKind,
  PLATFORM_TRAITS,
  SYSTEMS,
  navKindOf,
  platformOf,
} from '@/platform/platform'

/** The platform this device is, whose table and rules plan what it plays. */
export const DEVICE_PLATFORM: AppPlatform = platformOf({ os: Platform.OS, isTV: Platform.isTV })

/** What sets this device's build apart: how it is driven, its fonts, its player's ways. */
export const DEVICE_TRAITS = PLATFORM_TRAITS[DEVICE_PLATFORM]

/** How this device is driven, which picks every layout kit. */
export const DEVICE_INPUT = DEVICE_TRAITS.input

/**
 * How this device moves between pages, read from the system's idiom, which only iOS reports.
 * A function rather than a constant, so a render test can stand in an iPhone or an iPad.
 */
export const deviceNavKind = (): NavKind =>
  navKindOf({ isTV: Platform.isTV, isPad: Platform.OS === SYSTEMS.ios && Platform.isPad })
