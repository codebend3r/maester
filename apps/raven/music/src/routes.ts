/** Wren's route paths, one per file under `app/`. */
export const WREN_ROUTES = {
  home: '/',
  library: '/library',
  search: '/search',
  settings: '/settings',
  signIn: '/sign-in',
  nowPlaying: '/now-playing',
} as const

/** The pages a listing opens, each named by the id in its path. */
export const WREN_PAGES = {
  album: '/album/[id]',
  artist: '/artist/[id]',
  playlist: '/playlist/[id]',
} as const

type WrenPage = (typeof WREN_PAGES)[keyof typeof WREN_PAGES]

/** The params a page reads from its path, or Library from its query. */
export const WREN_ROUTE_PARAMS = { id: 'id', segment: 'segment' } as const

/** The lists the Library tab shows, one at a time, named in its query. */
export const LIBRARY_SEGMENTS = {
  albums: 'albums',
  artists: 'artists',
  songs: 'songs',
  playlists: 'playlists',
  downloads: 'downloads',
} as const

export type LibrarySegment = (typeof LIBRARY_SEGMENTS)[keyof typeof LIBRARY_SEGMENTS]

const isLibrarySegment = (value: unknown): value is LibrarySegment =>
  Object.values<unknown>(LIBRARY_SEGMENTS).includes(value)

/** The segment a Library address names, or Albums when it names none it knows. */
export const librarySegmentOf = (value: unknown): LibrarySegment =>
  isLibrarySegment(value) ? value : LIBRARY_SEGMENTS.albums

/** Where Library shows one of its lists. */
export const libraryHref = (segment: LibrarySegment) => ({
  pathname: WREN_ROUTES.library,
  params: { [WREN_ROUTE_PARAMS.segment]: segment },
})

/** Each route's name as its navigator knows it: its file under `app/`, without the extension. */
export const WREN_SCREENS = {
  tabs: '(tabs)',
  signIn: 'sign-in',
  album: 'album/[id]',
  artist: 'artist/[id]',
  playlist: 'playlist/[id]',
  nowPlaying: 'now-playing',
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
