import {
  HOME_COPY,
  LIBRARY_LABELS,
  LIBRARY_PAGE_COPY,
  SEARCH_COPY,
  SETTINGS_COPY,
  SHARED_ORDER,
} from '@raven/wren'
import { COLLECTION_KINDS, type CollectionKind, WREN_ROUTES, collectionPath } from '@/routes'
import { ICONS, type WrenIconName } from '@/ui/WrenIcon/icons'

/** One place the tab bar, the sidebar or Library opens: its name, its drawing and its address. */
export type Place = { label: string; icon: WrenIconName; path: string }

/** The four tabs, as the tab bar and the sidebar both name and draw them. */
export const TAB_PLACES = {
  home: { label: HOME_COPY.title, icon: ICONS.home, path: WREN_ROUTES.home },
  library: { label: LIBRARY_PAGE_COPY.title, icon: ICONS.library, path: WREN_ROUTES.library },
  search: { label: SEARCH_COPY.title, icon: ICONS.search, path: WREN_ROUTES.search },
  settings: { label: SETTINGS_COPY.title, icon: ICONS.settings, path: WREN_ROUTES.settings },
} as const satisfies Record<string, Place>

/** The four tabs, in the bar's order. */
export const TABS = [
  TAB_PLACES.home,
  TAB_PLACES.library,
  TAB_PLACES.search,
  TAB_PLACES.settings,
] as const satisfies readonly Place[]

/** Each of Library's categories' drawing. */
const LIBRARY_ICONS = {
  [COLLECTION_KINDS.albums]: ICONS.album,
  [COLLECTION_KINDS.artists]: ICONS.artist,
  [COLLECTION_KINDS.playlists]: ICONS.playlist,
  [COLLECTION_KINDS.unmatchedAlbums]: ICONS.alert,
  [COLLECTION_KINDS.inProgress]: ICONS.recent,
  [COLLECTION_KINDS.favourites]: ICONS.heart,
  [COLLECTION_KINDS.finished]: ICONS.check,
  [COLLECTION_KINDS.songs]: ICONS.song,
} as const satisfies Record<CollectionKind, WrenIconName>

/** One of Library's categories as a place: its kind beside its name, drawing and address. */
type LibraryPlace = Place & { kind: CollectionKind }

/**
 * Library's categories, in the order Library and the sidebar list them: raven's seven music
 * tabs in raven's order, then Songs; the apps' Downloads is left out, since a browser keeps none.
 */
export const LIBRARY_PLACES: readonly LibraryPlace[] = SHARED_ORDER.map((kind) => ({
  kind,
  label: LIBRARY_LABELS[kind],
  icon: LIBRARY_ICONS[kind],
  path: collectionPath(kind),
}))
