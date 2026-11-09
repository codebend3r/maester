/** The builds the app ships, which differ in what they can play and how they are driven. */
export const APP_PLATFORMS = { ios: 'ios', tvos: 'tvos', androidTv: 'androidTv' } as const

export type AppPlatform = (typeof APP_PLATFORMS)[keyof typeof APP_PLATFORMS]

/** What React Native's `Platform.OS` reports on the systems the app is built for. */
export const SYSTEMS = { ios: 'ios', android: 'android' } as const

type PlatformOfProps = { os: string; isTV: boolean }

/**
 * The platform from React Native's `Platform.OS` and `Platform.isTV`, passed in so the
 * answer is testable without React Native. Apple TV reports `ios`, as iPhone and iPad do,
 * so only `isTV` tells them apart. The only Android build is the TV one.
 */
export const platformOf = ({ os, isTV }: PlatformOfProps): AppPlatform => {
  if (os === SYSTEMS.ios) return isTV ? APP_PLATFORMS.tvos : APP_PLATFORMS.ios
  if (os === SYSTEMS.android) return APP_PLATFORMS.androidTv
  throw new Error(`raven's app is not built for ${os}`)
}

/**
 * How a device moves between the app's pages: the remote's focus on a TV, a tab bar along
 * the foot of an iPhone, and the side menu on an iPad.
 */
export const NAV_KINDS = { focus: 'focus', tabs: 'tabs', drawer: 'drawer' } as const

export type NavKind = (typeof NAV_KINDS)[keyof typeof NAV_KINDS]

type NavKindOfProps = { isTV: boolean; isPad: boolean }

/**
 * The way a device moves between pages, by the system's idiom rather than the window's size:
 * an iPad mini's shorter side is under the web's tablet breakpoint, and an iPad app in a narrow
 * Split View is still on an iPad, and both keep the side menu.
 */
export const navKindOf = ({ isTV, isPad }: NavKindOfProps): NavKind => {
  if (isTV) return NAV_KINDS.focus
  return isPad ? NAV_KINDS.drawer : NAV_KINDS.tabs
}
