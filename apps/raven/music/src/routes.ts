/** Wren's route paths, one per file under `app/`. */
export const WREN_ROUTES = {
  home: '/',
  library: '/library',
  search: '/search',
  settings: '/settings',
  signIn: '/sign-in',
} as const

/** The pages a listing opens, each named by the id in its path. */
export const WREN_PAGES = {
  album: '/album/[id]',
  artist: '/artist/[id]',
  playlist: '/playlist/[id]',
} as const

type WrenPage = (typeof WREN_PAGES)[keyof typeof WREN_PAGES]

/** The params a page reads from its path. */
export const WREN_ROUTE_PARAMS = { id: 'id' } as const

/** Each route's name as its navigator knows it: its file under `app/`, without the extension. */
export const WREN_SCREENS = {
  tabs: '(tabs)',
  signIn: 'sign-in',
  album: 'album/[id]',
  artist: 'artist/[id]',
  playlist: 'playlist/[id]',
} as const

/** The tabs' names as the tab navigator knows them, inside `app/(tabs)/`. */
export const WREN_TABS = {
  home: 'index',
  library: 'library',
  search: 'search',
  settings: 'settings',
} as const

type PageHrefProps = { page: WrenPage; id: number }

/** Where a page of one album, artist or playlist lives. */
export const pageHref = ({ page, id }: PageHrefProps) => ({
  pathname: page,
  params: { [WREN_ROUTE_PARAMS.id]: String(id) },
})
