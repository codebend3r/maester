import { APP_ROUTES } from '@/routes'

/** What the touch header's buttons and the side menu are called aloud, and the field's button. */
export const TOUCH_NAV_COPY = {
  home: 'Home',
  menu: 'Open menu',
  closeMenu: 'Close menu',
  sideMenu: 'Menu',
  theme: 'Theme',
  runSearch: 'Search',
  favourites: 'Favourites',
} as const

/** How long the menu takes to slide, in milliseconds. */
export const MENU_SLIDE_MS = 220

/** How far in from the left edge a swipe must start to pull the menu out. */
export const MENU_EDGE_WIDTH = 24

/** The widest the menu stands, on a tablet. */
const MENU_MAX_WIDTH = 360

/** How much of a phone's width the menu takes. */
const MENU_SHARE = 0.84

/** How wide the menu is on a screen `screen` points wide. */
export const menuWidthOf = (screen: number): number =>
  Math.min(Math.round(screen * MENU_SHARE), MENU_MAX_WIDTH)

/** A flick this fast, in points per millisecond, settles the menu whatever the distance. */
const FLICK = 0.5

/** A swipe this far, in points, settles the menu whatever its speed. */
const SWIPE_FAR = 80

type SwipeProps = { dx: number; vx: number }

/** Whether a swipe in from the edge opens the menu: far enough, or flicked. */
export const isOpenedBy = ({ dx, vx }: SwipeProps): boolean => dx > SWIPE_FAR || vx > FLICK

/** Whether a swipe back across the menu shuts it: far enough, or flicked. */
export const isClosedBy = ({ dx, vx }: SwipeProps): boolean => -dx > SWIPE_FAR || vx < -FLICK

/** How a menu entry moves: on top of Home, or in place of the page it is chosen from. */
export const MENU_MOVES = { push: 'push', replace: 'replace' } as const

export type MenuMove = (typeof MENU_MOVES)[keyof typeof MENU_MOVES]

type MenuMoveOfProps = { pathname: string }

/**
 * Home stays under whatever is opened from it, so Back returns to it; anywhere else an entry
 * takes the place of the page, so choosing entries one after another stacks no screens.
 */
export const menuMoveOf = ({ pathname }: MenuMoveOfProps): MenuMove =>
  pathname === APP_ROUTES.home ? MENU_MOVES.push : MENU_MOVES.replace

const PLAYER_PREFIX = APP_ROUTES.play.slice(0, APP_ROUTES.play.indexOf('['))

type IsPlayerPathProps = { pathname: string }

/** Whether the screen is the video player, which the menu never draws over. */
export const isPlayerPath = ({ pathname }: IsPlayerPathProps): boolean =>
  pathname.startsWith(PLAYER_PREFIX)

type HasEdgeSwipeProps = { pathname: string }

/**
 * Whether the page has an edge to pull the menu from: Home alone. Every other page's left
 * edge belongs to the system's swipe back.
 */
export const hasEdgeSwipe = ({ pathname }: HasEdgeSwipeProps): boolean =>
  pathname === APP_ROUTES.home
