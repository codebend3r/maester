import { LIBRARY_PAGE_COPY } from '@/copy/screens'
import { WREN_ICONS, type WrenIconName } from '@/icons'

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

/** Each category's drawing, as its row and its sidebar place draw it. */
export const LIBRARY_ICONS = {
  [LIBRARY_SEGMENTS.albums]: WREN_ICONS.album,
  [LIBRARY_SEGMENTS.artists]: WREN_ICONS.artist,
  [LIBRARY_SEGMENTS.playlists]: WREN_ICONS.playlist,
  [LIBRARY_SEGMENTS.unmatchedAlbums]: WREN_ICONS.alert,
  [LIBRARY_SEGMENTS.inProgress]: WREN_ICONS.recent,
  [LIBRARY_SEGMENTS.favourites]: WREN_ICONS.heart,
  [LIBRARY_SEGMENTS.finished]: WREN_ICONS.check,
  [LIBRARY_SEGMENTS.songs]: WREN_ICONS.song,
  [LIBRARY_SEGMENTS.downloads]: WREN_ICONS.downloads,
} as const satisfies Record<LibrarySegment, WrenIconName>

/** Whether a category is one a browser has too. */
const isSharedSegment = (segment: LibrarySegment): segment is SharedSegment =>
  segment !== LIBRARY_SEGMENTS.downloads

/** The categories a browser lists, in Library's order: every one but Downloads. */
export const SHARED_ORDER: readonly SharedSegment[] = LIBRARY_ORDER.filter(isSharedSegment)
