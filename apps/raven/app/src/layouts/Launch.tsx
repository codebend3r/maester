import { DEFAULT_THEME } from '@raven/core'
import { LaunchIntro, type LaunchProps } from '@raven/native'
import { type ComponentType, useEffect } from 'react'

import { Logo } from '@/layouts/Logo'
import { NAV_KINDS, type NavKind } from '@/platform/platform'
import { appThemeOf } from '@/theme/appTheme'
import { TV_SIZES } from '@/theme/tvSizes'

/** The mark's width as a TV opens raven, read from across the room. */
const LAUNCH_MARK_WIDTH = TV_SIZES.space8 * 4

/**
 * A TV's opening: raven's mark grows in on the splash's ground, the default theme's, and fades
 * once the routes are drawn under it, as Plex's and YouTube's TV apps open.
 */
const TvLaunch = ({ isReady, onShown }: LaunchProps) => (
  <LaunchIntro
    ground={appThemeOf(DEFAULT_THEME).palette.ground}
    isReady={isReady}
    mark={<Logo width={LAUNCH_MARK_WIDTH} />}
    onShown={onShown}
  />
)

/** A phone or tablet opens as it always has: the splash stays until the routes are drawn, then goes. */
const SplashLaunch = ({ isReady, onShown }: LaunchProps) => {
  useEffect(() => {
    if (isReady) onShown()
  }, [isReady, onShown])
  return null
}

/** How each device opens raven: a TV with the mark's intro, the rest straight from the splash. */
export const DEVICE_LAUNCHES = {
  [NAV_KINDS.focus]: TvLaunch,
  [NAV_KINDS.tabs]: SplashLaunch,
  [NAV_KINDS.drawer]: SplashLaunch,
} as const satisfies Record<NavKind, ComponentType<LaunchProps>>
