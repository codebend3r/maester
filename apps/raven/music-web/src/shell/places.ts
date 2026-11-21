import { HOME_COPY, LIBRARY_PAGE_COPY, SEARCH_COPY, SETTINGS_COPY } from '@raven/wren'
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

type LibraryPlaceOfProps = { kind: CollectionKind; label: string; icon: WrenIconName }

const libraryPlaceOf = ({ kind, label, icon }: LibraryPlaceOfProps) =>
  ({ kind, label, icon, path: collectionPath(kind) }) as const

/**
 * Library's categories, in the order Library and the sidebar list them: the apps' but Downloads,
 * which a browser keeps none of.
 */
export const LIBRARY_PLACES = [
  libraryPlaceOf({
    kind: COLLECTION_KINDS.playlists,
    label: LIBRARY_PAGE_COPY.playlists,
    icon: ICONS.playlist,
  }),
  libraryPlaceOf({
    kind: COLLECTION_KINDS.artists,
    label: LIBRARY_PAGE_COPY.artists,
    icon: ICONS.artist,
  }),
  libraryPlaceOf({
    kind: COLLECTION_KINDS.albums,
    label: LIBRARY_PAGE_COPY.albums,
    icon: ICONS.album,
  }),
  libraryPlaceOf({
    kind: COLLECTION_KINDS.songs,
    label: LIBRARY_PAGE_COPY.songs,
    icon: ICONS.song,
  }),
] as const satisfies readonly Place[]
