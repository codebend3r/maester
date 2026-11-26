import { HOME_COPY, LIBRARY_PAGE_COPY, SEARCH_COPY, SETTINGS_COPY } from '@raven/wren'

import { WREN_ROUTES } from '@raven/wren-native/headless'

/** The sidebar's places, in its order, each a tab of the phone's: its words and route. */
export const PLACES = [
  { title: HOME_COPY.title, route: WREN_ROUTES.home },
  { title: LIBRARY_PAGE_COPY.title, route: WREN_ROUTES.library },
  { title: SEARCH_COPY.title, route: WREN_ROUTES.search },
  { title: SETTINGS_COPY.title, route: WREN_ROUTES.settings },
] as const

export type Place = (typeof PLACES)[number]

type PlaceOfProps = { pathname: string }

/**
 * The place a path belongs to, for the sidebar to mark: Home only at the root, any other the
 * place whose route the path starts with; null for a page outside the tabs.
 */
export const placeOf = ({ pathname }: PlaceOfProps): Place | null =>
  PLACES.find(({ route }) =>
    route === WREN_ROUTES.home ? pathname === route : pathname.startsWith(route),
  ) ?? null
