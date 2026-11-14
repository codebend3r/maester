import {
  type AppPath,
  HOME_SEARCH_PARAM,
  PAGE_PATHS,
  type TitleRequestAsk,
  UPCOMING_TITLE_PARAMS,
  type UpcomingShelf,
  libraryPath,
  toQueryString,
} from '@raven/core'

/**
 * Every page of raven's own frame, as `AppRoutes` declares it: the route a
 * page answers on, with react-router's `:name` placeholders. A link to one
 * page builds its address with core's path builders (`libraryPath`,
 * `showPath` and the rest) or the ones below, never by hand.
 */
export const APP_PATHS = {
  home: '/',
  libraries: '/libraries',
  library: '/libraries/:id',
  libraryHistory: '/libraries/:id/history',
  librarySection: '/libraries/:id/:section',
  saga: '/libraries/:id/sagas/:sagaId',
  movie: '/movies/:id',
  show: '/shows/:id',
  season: '/shows/:id/seasons/:number',
  episode: '/episodes/:id',
  person: '/people/:id',
  album: '/albums/:id',
  artist: '/artists/:id',
  binge: '/binge',
  continueWatching: '/continue-watching',
  comingSoon: '/coming-soon',
  comingSoonTitle: `/coming-soon/:${UPCOMING_TITLE_PARAMS.type}/:${UPCOMING_TITLE_PARAMS.tmdbId}`,
  favourites: '/favourites',
  history: '/history',
  everyonesHistory: '/history/everyone',
  streams: '/streams',
  reports: '/reports',
  notifications: '/notifications',
  settings: PAGE_PATHS.settings,
  admin: '/admin',
  shortcuts: PAGE_PATHS.shortcuts,
  design: '/design',
  watch: `${PAGE_PATHS.watch}/:id`,
  get: '/get',
} as const satisfies Record<string, AppPath>

/** A library's history of what was watched in it. */
export const libraryHistoryPath = (libraryId: number): AppPath =>
  `${libraryPath(libraryId)}/history`

/** Where a Coming soon shelf's own page is. */
export const comingSoonShelfPath = (shelf: UpcomingShelf): AppPath =>
  `${APP_PATHS.comingSoon}/${shelf}`

/** Where an upcoming title's own page is: `/coming-soon/movie/123`. */
export const comingSoonTitlePath = ({ type, tmdbId }: TitleRequestAsk): AppPath =>
  `${APP_PATHS.comingSoon}/${type}/${tmdbId}`

type LibrarySearchPathProps = { libraryId: number; query: string }

/** A library's page searched for `query`, or the library itself for an empty one. */
export const librarySearchPath = ({ libraryId, query }: LibrarySearchPathProps): AppPath =>
  query === ''
    ? libraryPath(libraryId)
    : `${libraryPath(libraryId)}?${toQueryString({ [PAGE_PARAMS.search]: query })}`

/** The search params a page reads off its own address. */
export const PAGE_PARAMS = {
  search: HOME_SEARCH_PARAM,
  library: 'library',
  file: 'file',
  credits: 'credits',
  kind: 'kind',
  os: 'os',
  sort: 'sort',
  view: 'view',
  group: 'group',
} as const
