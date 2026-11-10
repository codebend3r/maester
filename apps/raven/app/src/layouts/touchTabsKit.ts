import { TOUCH_NAV_COPY } from '@/layouts/touchMenuKit'
import { APP_ROUTES } from '@/routes'

/** The phone's tab bar's slots, in the bar's order: the web's phone bar with Continue watching for its Music. */
export const TOUCH_TABS = {
  home: 'home',
  libraries: 'libraries',
  favourites: 'favourites',
  continueWatching: 'continueWatching',
  more: 'more',
} as const

export type TouchTab = (typeof TOUCH_TABS)[keyof typeof TOUCH_TABS]

/** What the tab bar and its More sheet say, on screen and aloud. */
export const TOUCH_TABS_COPY = {
  bar: 'Pages',
  home: TOUCH_NAV_COPY.home,
  libraries: TOUCH_NAV_COPY.libraries,
  favourites: TOUCH_NAV_COPY.favourites,
  continueWatching: TOUCH_NAV_COPY.continueWatching,
  /** Continue watching's name under its icon, where a fifth of a phone fits one word. */
  continueShort: 'Continue',
  more: 'More',
  /** The sheet itself, as a screen reader names it. */
  moreSheet: 'More pages',
  closeMore: 'Close More',
  search: 'Search',
} as const

/** How many tiles stand in each row of the More sheet. */
export const MORE_COLUMNS = 3

const LIBRARY_PREFIX = APP_ROUTES.library.slice(0, APP_ROUTES.library.indexOf('['))

/** The tab each page lights; More stands for the pages only its sheet opens. */
const TAB_OF_PAGE: ReadonlyMap<string, TouchTab> = new Map([
  [APP_ROUTES.home, TOUCH_TABS.home],
  [APP_ROUTES.libraries, TOUCH_TABS.libraries],
  [APP_ROUTES.favourites, TOUCH_TABS.favourites],
  [APP_ROUTES.continueWatching, TOUCH_TABS.continueWatching],
  [APP_ROUTES.search, TOUCH_TABS.more],
  [APP_ROUTES.settings, TOUCH_TABS.more],
  [APP_ROUTES.downloads, TOUCH_TABS.more],
])

type ActiveTabOfProps = { pathname: string; isMoreOpen: boolean }

/**
 * The tab lit for the page: More while its sheet is up, Libraries on any one library, the
 * page's own tab where it has one, and none on a page no tab opens (an item, an album).
 */
export const activeTabOf = ({ pathname, isMoreOpen }: ActiveTabOfProps): TouchTab | null => {
  if (isMoreOpen) return TOUCH_TABS.more
  if (pathname.startsWith(LIBRARY_PREFIX)) return TOUCH_TABS.libraries
  return TAB_OF_PAGE.get(pathname) ?? null
}
