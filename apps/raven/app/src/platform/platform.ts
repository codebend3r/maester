/** The builds the app ships, which differ in what they can play and how they are driven. */
export const APP_PLATFORMS = { ios: 'ios', tvos: 'tvos', androidTv: 'androidTv' } as const

export type AppPlatform = (typeof APP_PLATFORMS)[keyof typeof APP_PLATFORMS]

/** What React Native's `Platform.OS` reports on the systems the app is built for. */
export const SYSTEMS = { ios: 'ios', android: 'android' } as const

/**
 * The platform from React Native's `Platform.OS` and `Platform.isTV`, passed in so the
 * answer is testable without React Native. Apple TV reports `ios`, as iPhone and iPad do,
 * so only `isTV` tells them apart. The only Android build is the TV one.
 */
export const platformOf = ({ os, isTV }: { os: string; isTV: boolean }): AppPlatform => {
  if (os === SYSTEMS.ios) return isTV ? APP_PLATFORMS.tvos : APP_PLATFORMS.ios
  if (os === SYSTEMS.android) return APP_PLATFORMS.androidTv
  throw new Error(`raven's app is not built for ${os}`)
}
