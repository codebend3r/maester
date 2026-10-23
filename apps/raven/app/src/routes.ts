/** The app's route paths, one per file under `app/`. */
export const APP_ROUTES = {
  home: '/',
  signIn: '/sign-in',
  item: '/item/[id]',
  unlock: '/unlock',
} as const

/** Each route's name as its navigator knows it: its file under `app/`, without the extension. */
export const APP_SCREENS = {
  home: 'index',
  item: 'item/[id]',
  unlock: 'unlock',
} as const
