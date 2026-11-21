import { useLocation } from 'react-router-dom'
import { WREN_ROUTES } from '@/routes'
import { TABS } from '@/shell/places'

/**
 * What surrounds the page showing: nothing on sign-in and Now Playing, the tab bar on a tab, or
 * a page opened from one. The wide layout draws its sidebar and player bar around both of the
 * last two.
 */
export const CHROMES = { bare: 'bare', tabs: 'tabs', page: 'page' } as const

export type Chrome = (typeof CHROMES)[keyof typeof CHROMES]

/** The pages drawn alone: sign-in, and Now Playing, which is the player opened up. */
const BARE_PATHS: ReadonlySet<string> = new Set([WREN_ROUTES.signIn, WREN_ROUTES.nowPlaying])

/** The four tabs: Home, Library, Search and Settings. */
const TAB_PATHS: ReadonlySet<string> = new Set(TABS.map(({ path }) => path))

/** A path as the routes name it: with no slash at its end, but for Home's own. */
const trimmed = (pathname: string): string => pathname.replace(/(?<=.)\/+$/, '')

type ChromeOfProps = { pathname: string }

/** The chrome around a page, by its path. */
export const chromeOf = ({ pathname }: ChromeOfProps): Chrome => {
  const path = trimmed(pathname)
  if (BARE_PATHS.has(path)) return CHROMES.bare
  if (TAB_PATHS.has(path)) return CHROMES.tabs
  return CHROMES.page
}

/** The chrome around the page showing now. */
export const useChrome = (): Chrome => chromeOf({ pathname: useLocation().pathname })
