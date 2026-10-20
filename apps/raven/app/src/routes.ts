/** The app's route paths, one per file under `app/`. */
export const APP_ROUTES = {
  home: '/',
  signIn: '/sign-in',
  item: '/item/[id]',
  library: '/library/[id]',
  unlock: '/unlock',
} as const

/** The params the routes' file names carry, as `useLocalSearchParams` reads them. */
export const APP_ROUTE_PARAMS = { id: 'id' } as const

/** Each route's name as its navigator knows it: its file under `app/`, without the extension. */
export const APP_SCREENS = {
  home: 'index',
  item: 'item/[id]',
  library: 'library/[id]',
  unlock: 'unlock',
} as const
