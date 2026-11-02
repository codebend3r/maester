import {
  DEFAULT_SAGA_BACKDROP,
  type EpisodeSummary,
  HOME_SHELF_TYPES,
  type Home,
  isHome,
  isItemDetails,
  isLibraryList,
  isSagaList,
  type ItemDetails,
  type ItemSummary,
  ITEM_TYPES,
  type Library,
  LIBRARY_KINDS,
  type MediaItem,
  type Saga,
  type SeasonSummary,
} from '@raven/core'
import { details, library, summary } from '@/main/test/serverFakes'

/**
 * The titles the fixture holds, by media id. `page` answers its file with an HTML page and a
 * 200, as a proxy's sign-in page in front of a server does; `redirecting` sends its file from
 * the second listener. The episodes are the show's.
 */
export const FIXTURE_MEDIA = {
  first: 1,
  second: 2,
  redirecting: 3,
  page: 4,
  firstEpisode: 5,
  secondEpisode: 6,
} as const

/**
 * The libraries and items the fixture holds, by the ids its pages and download links name: a
 * movies library with two movies, whose files are `first` and `second`, and a shows library with
 * a show, its season and the season's two episodes. The saga holds the two movies.
 */
export const FIXTURE_ITEMS = {
  library: 1,
  showLibrary: 2,
  show: 10,
  season: 11,
  firstEpisode: 12,
  secondEpisode: 13,
  firstMovie: 20,
  secondMovie: 21,
  saga: '100',
} as const

/** What each title is called, as the web shows it. */
export const FIXTURE_TITLES = {
  first: 'Fixture One',
  second: 'Fixture Two',
  show: 'Fixture Show',
  season: 'Season 1',
  firstEpisode: 'Episode One',
  secondEpisode: 'Episode Two',
} as const

const ADDED_AT = '2026-10-16T00:00:00.000Z'
const FIXTURE_YEAR = 2026

/** How a movie is named where its year goes with it: the player, the download dialog, Downloads. */
export const FIXTURE_MOVIE_NAMES = {
  first: `${FIXTURE_TITLES.first} (${FIXTURE_YEAR})`,
  second: `${FIXTURE_TITLES.second} (${FIXTURE_YEAR})`,
} as const

const FIXTURE_SHOW = { id: FIXTURE_ITEMS.show, title: FIXTURE_TITLES.show }

type MovieSummaryProps = { id: number; title: string }

const movieSummary = ({ id, title }: MovieSummaryProps): ItemSummary =>
  summary({ id, type: ITEM_TYPES.movie, title, year: FIXTURE_YEAR })

type EpisodeSummaryProps = {
  id: number
  number: number
  title: string
}

const episodeSummary = ({ id, number, title }: EpisodeSummaryProps): ItemSummary =>
  summary({
    id,
    type: ITEM_TYPES.episode,
    title,
    year: null,
    show: FIXTURE_SHOW,
    season: 1,
    episode: number,
  })

/** The item each title is, so its card links to its page; null for a file matched to none. */
export const FIXTURE_TITLE_ITEMS: ReadonlyMap<number, ItemSummary> = new Map([
  [
    FIXTURE_MEDIA.first,
    movieSummary({ id: FIXTURE_ITEMS.firstMovie, title: FIXTURE_TITLES.first }),
  ],
  [
    FIXTURE_MEDIA.second,
    movieSummary({ id: FIXTURE_ITEMS.secondMovie, title: FIXTURE_TITLES.second }),
  ],
  [
    FIXTURE_MEDIA.firstEpisode,
    episodeSummary({
      id: FIXTURE_ITEMS.firstEpisode,
      number: 1,
      title: FIXTURE_TITLES.firstEpisode,
    }),
  ],
  [
    FIXTURE_MEDIA.secondEpisode,
    episodeSummary({
      id: FIXTURE_ITEMS.secondEpisode,
      number: 2,
      title: FIXTURE_TITLES.secondEpisode,
    }),
  ],
])

const seasonSummary = summary({
  id: FIXTURE_ITEMS.season,
  type: ITEM_TYPES.season,
  title: FIXTURE_TITLES.season,
  year: null,
  show: FIXTURE_SHOW,
  season: 1,
})

const seasonCard: SeasonSummary = {
  ...seasonSummary,
  type: ITEM_TYPES.season,
  episodeCount: 2,
  watchedCount: 0,
}

type EpisodeCardProps = {
  item: ItemSummary
  primary: MediaItem
}

const episodeCard = ({ item, primary }: EpisodeCardProps): EpisodeSummary => ({
  ...item,
  type: ITEM_TYPES.episode,
  summary: null,
  released: null,
  runtime: null,
  stillVersion: null,
  watched: false,
  primary,
})

type TitleDetailsProps = { item: ItemSummary; primary: MediaItem }

/** A movie's or an episode's own page: the item, with its file as its one version. */
const titleDetails = ({ item, primary }: TitleDetailsProps): ItemDetails =>
  details({ ...item, tmdbId: String(item.id), versions: [primary] })

type LibraryOfProps = {
  id: number
  name: string
  kind: Library['settings']['kind']
}

const libraryOf = ({ id, name, kind }: LibraryOfProps): Library => {
  const base = library({ id, watchedPercent: 90 })
  return { ...base, name, settings: { ...base.settings, kind } }
}

const itemOf = (mediaId: number): ItemSummary => {
  const found = FIXTURE_TITLE_ITEMS.get(mediaId)
  if (found === undefined) throw new Error(`The fixture has no item for media ${mediaId}`)
  return found
}

export type FixtureCatalog = {
  items: ReadonlyMap<number, ItemDetails>
  libraries: readonly Library[]
  sagas: readonly Saga[]
  home: Home
}

type MediaOfProps = {
  media: ReadonlyMap<number, MediaItem>
  mediaId: number
}

const mediaOf = ({ media, mediaId }: MediaOfProps) => {
  const found = media.get(mediaId)
  if (found === undefined) throw new Error(`The fixture lost media ${mediaId}`)
  return found
}

type CatalogOfProps = { media: ReadonlyMap<number, MediaItem> }

/**
 * What the server's library routes answer, built on the titles as `GET /api/media/:id` answers
 * them, and checked against core's guards so a page never reads a shape the server never sends.
 */
export const catalogOf = ({ media }: CatalogOfProps): FixtureCatalog => {
  const first = mediaOf({ media, mediaId: FIXTURE_MEDIA.first })
  const second = mediaOf({ media, mediaId: FIXTURE_MEDIA.second })
  const firstEpisode = mediaOf({ media, mediaId: FIXTURE_MEDIA.firstEpisode })
  const secondEpisode = mediaOf({ media, mediaId: FIXTURE_MEDIA.secondEpisode })
  const titlePages = [...FIXTURE_TITLE_ITEMS].map(([mediaId, item]): [number, ItemDetails] => [
    item.id,
    titleDetails({ item, primary: mediaOf({ media, mediaId }) }),
  ])
  const items: ReadonlyMap<number, ItemDetails> = new Map([
    ...titlePages,
    [
      FIXTURE_ITEMS.show,
      details({
        id: FIXTURE_ITEMS.show,
        type: ITEM_TYPES.show,
        title: FIXTURE_TITLES.show,
        year: null,
        tmdbId: String(FIXTURE_ITEMS.show),
        children: [seasonCard],
      }),
    ],
    [
      FIXTURE_ITEMS.season,
      details({
        ...seasonSummary,
        tmdbId: String(FIXTURE_ITEMS.season),
        children: [firstEpisode, secondEpisode].map((primary) =>
          episodeCard({ item: itemOf(primary.id), primary }),
        ),
      }),
    ],
  ])
  const libraries = [
    libraryOf({ id: FIXTURE_ITEMS.library, name: 'Fixture Movies', kind: LIBRARY_KINDS.movies }),
    libraryOf({ id: FIXTURE_ITEMS.showLibrary, name: 'Fixture Shows', kind: LIBRARY_KINDS.shows }),
  ]
  const sagas: Saga[] = [
    {
      tmdbId: FIXTURE_ITEMS.saga,
      name: 'Fixture Saga',
      backdrop: DEFAULT_SAGA_BACKDROP,
      media: [first, second],
    },
  ]
  const home: Home = {
    inProgress: [],
    shelves: [
      { libraryId: FIXTURE_ITEMS.library, type: HOME_SHELF_TYPES.media, media: [first, second] },
      {
        libraryId: FIXTURE_ITEMS.showLibrary,
        type: HOME_SHELF_TYPES.shows,
        shows: [
          {
            show: summary({ ...FIXTURE_SHOW, type: ITEM_TYPES.show, year: null }),
            episodes: 2,
            seasons: 1,
            totalEpisodes: 2,
            watchedEpisodes: 0,
            endedYear: null,
            addedAt: ADDED_AT,
            bitrate: null,
            next: firstEpisode,
          },
        ],
      },
    ],
  }
  if (![...items.values()].every(isItemDetails) || !isLibraryList(libraries)) {
    throw new Error('The fixture library is not what the server answers')
  }
  if (!isSagaList(sagas) || !isHome(home)) {
    throw new Error('The fixture saga or home is not what the server answers')
  }
  return { items, libraries, sagas, home }
}
