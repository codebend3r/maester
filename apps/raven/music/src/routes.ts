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

/** Library's categories, each a page the stack pushes, named by its kind in its path. */
const COLLECTION_PAGE = '/collection/[kind]'

type WrenPage = (typeof WREN_PAGES)[keyof typeof WREN_PAGES]

/** The params a page reads from its path, or Library from its query. */
export const WREN_ROUTE_PARAMS = { id: 'id', segment: 'segment', kind: 'kind' } as const

/** Library's lists, each a category page of its own and named in its path. */
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

/** Where one of Library's lists is: its category page, `/collection/albums`. */
export const libraryHref = (segment: LibrarySegment) => ({
  pathname: COLLECTION_PAGE,
  params: { [WREN_ROUTE_PARAMS.kind]: segment },
})

/** A category page's address as it shows in the path, for telling which one is open. */
export const collectionPathOf = (segment: LibrarySegment): string =>
  COLLECTION_PAGE.replace(`[${WREN_ROUTE_PARAMS.kind}]`, segment)

/** Each route's name as its navigator knows it: its file under `app/`, without the extension. */
export const WREN_SCREENS = {
  tabs: '(tabs)',
  signIn: 'sign-in',
  album: 'album/[id]',
  artist: 'artist/[id]',
  playlist: 'playlist/[id]',
  collection: 'collection/[kind]',
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
