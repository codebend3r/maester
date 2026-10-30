/** Wren's route paths, one per file under `app/`. */
export const WREN_ROUTES = {
  home: '/',
  library: '/library',
  search: '/search',
  settings: '/settings',
  signIn: '/sign-in',
} as const

/** Each route's name as its navigator knows it: its file under `app/`, without the extension. */
export const WREN_SCREENS = {
  tabs: '(tabs)',
  signIn: 'sign-in',
} as const

/** The tabs' names as the tab navigator knows them, inside `app/(tabs)/`. */
export const WREN_TABS = {
  home: 'index',
  library: 'library',
  search: 'search',
  settings: 'settings',
} as const
