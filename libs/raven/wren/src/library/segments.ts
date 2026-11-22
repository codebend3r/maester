import { LIBRARY_PAGE_COPY } from '@/copy/screens'

/**
 * Library's lists, each a category page of its own and named in its path: raven's music tabs,
 * under the names raven's own addresses give them, then Songs and Downloads.
 */
export const LIBRARY_SEGMENTS = {
  albums: 'albums',
  artists: 'artists',
  playlists: 'playlists',
  unmatchedAlbums: 'unmatched-albums',
  inProgress: 'in-progress',
  favourites: 'favourites',
  finished: 'finished',
  songs: 'songs',
  downloads: 'downloads',
} as const

export type LibrarySegment = (typeof LIBRARY_SEGMENTS)[keyof typeof LIBRARY_SEGMENTS]

/** The one category only the phone and tablet apps have, since a browser keeps no downloads. */
type DeviceSegment = typeof LIBRARY_SEGMENTS.downloads

/** Every category a browser has too. */
export type SharedSegment = Exclude<LibrarySegment, DeviceSegment>

/**
 * The order Library and the sidebars list the categories in: raven's seven music tabs in raven's
 * order, then Songs, then Downloads where the device keeps any.
 */
export const LIBRARY_ORDER = [
  LIBRARY_SEGMENTS.albums,
  LIBRARY_SEGMENTS.artists,
  LIBRARY_SEGMENTS.playlists,
  LIBRARY_SEGMENTS.unmatchedAlbums,
  LIBRARY_SEGMENTS.inProgress,
  LIBRARY_SEGMENTS.favourites,
  LIBRARY_SEGMENTS.finished,
  LIBRARY_SEGMENTS.songs,
  LIBRARY_SEGMENTS.downloads,
] as const satisfies readonly LibrarySegment[]

/** Each category's name, as its row, its sidebar place and its page's title say it. */
export const LIBRARY_LABELS = {
  [LIBRARY_SEGMENTS.albums]: LIBRARY_PAGE_COPY.albums,
  [LIBRARY_SEGMENTS.artists]: LIBRARY_PAGE_COPY.artists,
  [LIBRARY_SEGMENTS.playlists]: LIBRARY_PAGE_COPY.playlists,
  [LIBRARY_SEGMENTS.unmatchedAlbums]: LIBRARY_PAGE_COPY.unmatchedAlbums,
  [LIBRARY_SEGMENTS.inProgress]: LIBRARY_PAGE_COPY.inProgress,
  [LIBRARY_SEGMENTS.favourites]: LIBRARY_PAGE_COPY.favourites,
  [LIBRARY_SEGMENTS.finished]: LIBRARY_PAGE_COPY.finished,
  [LIBRARY_SEGMENTS.songs]: LIBRARY_PAGE_COPY.songs,
  [LIBRARY_SEGMENTS.downloads]: LIBRARY_PAGE_COPY.downloads,
} as const satisfies Record<LibrarySegment, string>

/** Whether a category is one a browser has too. */
const isSharedSegment = (segment: LibrarySegment): segment is SharedSegment =>
  segment !== LIBRARY_SEGMENTS.downloads

/** The categories a browser lists, in Library's order: every one but Downloads. */
export const SHARED_ORDER: readonly SharedSegment[] = LIBRARY_ORDER.filter(isSharedSegment)
