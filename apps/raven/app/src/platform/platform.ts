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

/** How a device is driven: the remote's focus on a TV, a finger everywhere else. */
export const INPUT_KINDS = { focus: 'focus', touch: 'touch' } as const

export type InputKind = (typeof INPUT_KINDS)[keyof typeof INPUT_KINDS]

/** Whose fonts a platform names: Android's by file, Apple's by family. */
export const FONT_SYSTEMS = { android: 'android', apple: 'apple' } as const

export type FontSystem = (typeof FONT_SYSTEMS)[keyof typeof FONT_SYSTEMS]

/** What sets one build apart from the others, read once wherever the platform matters. */
type PlatformTraits = {
  /** How it is driven, which picks every layout kit. */
  input: InputKind
  fonts: FontSystem
  /**
   * Whether the player resumes by a seek of ours once loaded rather than by the library's
   * `startPosition`: AVPlayer, on iPhone, iPad and Apple TV alike (see `startUp.ts`). The library
   * applies a `startPosition` of 0 too, so on Apple TV every start sat on the opening mark.
   */
  shouldSeekToResume: boolean
  /**
   * Whether a direct play is watched for a missing picture: Apple's players play a file whose
   * video they cannot decode as sound alone, where ExoPlayer reports what it cannot decode.
   */
  shouldWatchMissingPicture: boolean
  /**
   * Whether a direct play is judged for a dropped audio track: ExoPlayer selects no track it can
   * neither decode nor pass through and says nothing, where Apple's tables name only what decodes.
   */
  shouldJudgeDroppedAudio: boolean
}

/** Each build's traits. */
export const PLATFORM_TRAITS = {
  [APP_PLATFORMS.ios]: {
    input: INPUT_KINDS.touch,
    fonts: FONT_SYSTEMS.apple,
    shouldSeekToResume: true,
    shouldWatchMissingPicture: true,
    shouldJudgeDroppedAudio: false,
  },
  [APP_PLATFORMS.tvos]: {
    input: INPUT_KINDS.focus,
    fonts: FONT_SYSTEMS.apple,
    shouldSeekToResume: true,
    shouldWatchMissingPicture: true,
    shouldJudgeDroppedAudio: false,
  },
  [APP_PLATFORMS.androidTv]: {
    input: INPUT_KINDS.focus,
    fonts: FONT_SYSTEMS.android,
    shouldSeekToResume: false,
    shouldWatchMissingPicture: false,
    shouldJudgeDroppedAudio: true,
  },
} as const satisfies Record<AppPlatform, PlatformTraits>
