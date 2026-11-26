import { LIBRARY_LABELS, LIBRARY_SEGMENTS, SHARED_ORDER, type SharedSegment } from '@raven/wren'

import { ICONS, type WrenIconName } from '@/ui/WrenIcon'

/** Each of Library's categories' drawing, the phone's. */
const LIBRARY_ICONS = {
  [LIBRARY_SEGMENTS.albums]: ICONS.album,
  [LIBRARY_SEGMENTS.artists]: ICONS.artist,
  [LIBRARY_SEGMENTS.playlists]: ICONS.playlist,
  [LIBRARY_SEGMENTS.unmatchedAlbums]: ICONS.alert,
  [LIBRARY_SEGMENTS.inProgress]: ICONS.recent,
  [LIBRARY_SEGMENTS.favourites]: ICONS.heart,
  [LIBRARY_SEGMENTS.finished]: ICONS.check,
  [LIBRARY_SEGMENTS.songs]: ICONS.song,
} as const satisfies Record<SharedSegment, WrenIconName>

/** One of Library's categories: its kind, its name and its drawing. */
type Category = { kind: SharedSegment; label: string; icon: WrenIconName }

/**
 * Library's categories in Library's order: raven's seven music tabs in raven's order, then
 * Songs. A TV keeps no downloads, so Downloads is left out, as on the web.
 */
export const CATEGORIES: readonly Category[] = SHARED_ORDER.map((kind) => ({
  kind,
  label: LIBRARY_LABELS[kind],
  icon: LIBRARY_ICONS[kind],
}))
