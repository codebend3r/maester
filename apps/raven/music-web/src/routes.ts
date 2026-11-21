import { LIBRARY_SEGMENTS, type LibrarySegment, oneOfOr } from '@raven/wren'
import { generatePath } from 'react-router-dom'

/** Wren's pages, one per file under the phone and tablet apps' `app/`, by the same names. */
export const WREN_ROUTES = {
  home: '/',
  library: '/library',
  search: '/search',
  settings: '/settings',
  signIn: '/sign-in',
  nowPlaying: '/now-playing',
  album: '/album/:id',
  artist: '/artist/:id',
  playlist: '/playlist/:id',
  collection: '/collection/:kind',
} as const

/** The params a page reads from its path. */
export const WREN_ROUTE_PARAMS = { id: 'id', kind: 'kind' } as const

/** Where an album's page lives. */
export const albumPath = (id: number): string =>
  generatePath(WREN_ROUTES.album, { [WREN_ROUTE_PARAMS.id]: String(id) })

/** Where an artist's page lives. */
export const artistPath = (id: number): string =>
  generatePath(WREN_ROUTES.artist, { [WREN_ROUTE_PARAMS.id]: String(id) })

/** Where a playlist's page lives. */
export const playlistPath = (id: number): string =>
  generatePath(WREN_ROUTES.playlist, { [WREN_ROUTE_PARAMS.id]: String(id) })

/**
 * Library's lists on the web, each a page of its own: every segment of the apps' but
 * Downloads, since a browser keeps none.
 */
export const COLLECTION_KINDS = {
  playlists: LIBRARY_SEGMENTS.playlists,
  artists: LIBRARY_SEGMENTS.artists,
  albums: LIBRARY_SEGMENTS.albums,
  songs: LIBRARY_SEGMENTS.songs,
} as const satisfies Partial<Record<LibrarySegment, LibrarySegment>>

export type CollectionKind = (typeof COLLECTION_KINDS)[keyof typeof COLLECTION_KINDS]

/** The list a category page's address names, or Albums when it names none the web has. */
export const collectionKindOf = oneOfOr<CollectionKind>({
  values: Object.values(COLLECTION_KINDS),
  fallback: COLLECTION_KINDS.albums,
})

/** Where one of Library's lists is: its category page, `/collection/albums`. */
export const collectionPath = (kind: CollectionKind): string =>
  generatePath(WREN_ROUTES.collection, { [WREN_ROUTE_PARAMS.kind]: kind })
