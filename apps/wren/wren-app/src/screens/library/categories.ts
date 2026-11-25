import { LIBRARY_LABELS, LIBRARY_ORDER, LIBRARY_SEGMENTS, type LibrarySegment } from '@raven/wren'

import { ICONS, type WrenIconName } from '@/ui/WrenIcon'

/** Each of Library's categories' drawing. */
const LIBRARY_ICONS = {
  [LIBRARY_SEGMENTS.albums]: ICONS.album,
  [LIBRARY_SEGMENTS.artists]: ICONS.artist,
  [LIBRARY_SEGMENTS.playlists]: ICONS.playlist,
  [LIBRARY_SEGMENTS.unmatchedAlbums]: ICONS.alert,
  [LIBRARY_SEGMENTS.inProgress]: ICONS.recent,
  [LIBRARY_SEGMENTS.favourites]: ICONS.heart,
  [LIBRARY_SEGMENTS.finished]: ICONS.check,
  [LIBRARY_SEGMENTS.songs]: ICONS.song,
  [LIBRARY_SEGMENTS.downloads]: ICONS.downloads,
} as const satisfies Record<LibrarySegment, WrenIconName>

/** One of Library's categories: its kind, its name and its drawing. */
export type Category = { kind: LibrarySegment; label: string; icon: WrenIconName }

/**
 * Library's categories in the order Library and the tablet's sidebar list them: raven's seven
 * music tabs in raven's order, then Songs and Downloads.
 */
export const CATEGORIES: readonly Category[] = LIBRARY_ORDER.map((kind) => ({
  kind,
  label: LIBRARY_LABELS[kind],
  icon: LIBRARY_ICONS[kind],
}))
