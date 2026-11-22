import { oneOf, orElse } from '@raven/core'
import { LIBRARY_SEGMENTS, type SharedSegment } from '@raven/wren'
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
  albums: LIBRARY_SEGMENTS.albums,
  artists: LIBRARY_SEGMENTS.artists,
  playlists: LIBRARY_SEGMENTS.playlists,
  unmatchedAlbums: LIBRARY_SEGMENTS.unmatchedAlbums,
  inProgress: LIBRARY_SEGMENTS.inProgress,
  favourites: LIBRARY_SEGMENTS.favourites,
  finished: LIBRARY_SEGMENTS.finished,
  songs: LIBRARY_SEGMENTS.songs,
} as const satisfies Record<string, SharedSegment>

export type CollectionKind = (typeof COLLECTION_KINDS)[keyof typeof COLLECTION_KINDS]

/** The list a category page's address names, or Albums when it names none the web has. */
export const collectionKindOf = orElse<CollectionKind>({
  guard: oneOf(Object.values(COLLECTION_KINDS)),
  fallback: COLLECTION_KINDS.albums,
})

/** Where one of Library's lists is: its category page, `/collection/albums`. */
export const collectionPath = (kind: CollectionKind): string =>
  generatePath(WREN_ROUTES.collection, { [WREN_ROUTE_PARAMS.kind]: kind })
