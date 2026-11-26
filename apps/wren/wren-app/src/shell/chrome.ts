import { WREN_SCREENS } from '@raven/wren-native/headless'

/**
 * What surrounds the screen showing: nothing on sign-in and Now Playing, the tab bar on a tab,
 * or a page the stack pushed.
 */
export const CHROMES = { bare: 'bare', tabs: 'tabs', page: 'page' } as const

export type Chrome = (typeof CHROMES)[keyof typeof CHROMES]

/** The screens drawn alone: sign-in, and Now Playing, which is the player opened up. */
const BARE_SCREENS: ReadonlySet<string> = new Set([WREN_SCREENS.signIn, WREN_SCREENS.nowPlaying])

type ChromeOfProps = { screen: string }

/** The chrome around a screen, by its route's first segment. */
export const chromeOf = ({ screen }: ChromeOfProps): Chrome => {
  if (BARE_SCREENS.has(screen)) return CHROMES.bare
  if (screen === WREN_SCREENS.tabs) return CHROMES.tabs
  return CHROMES.page
}
