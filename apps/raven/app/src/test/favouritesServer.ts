import {
  APP_CALL_METHODS,
  APP_CLIENT_CALLS,
  type AlbumSummary,
  type ApiClient,
  type Artist,
  ITEM_TYPES,
  type ItemSummary,
  type PosterEntry,
  createApiClient,
} from '@raven/core'
import { allowlistedFetch } from '@raven/native/headless'

import { type Answer, NOT_FOUND, STATUSES, responseOf } from '@/test/fixtureFetch'
import { FILMS, NAS, SERIES } from '@/test/homeServer'
import { mediaItemFor, summaryFor } from '@/test/mediaItem'
import { OK_COMPUTER, RADIOHEAD } from '@/test/musicServer'

const SEVERANCE: ItemSummary = summaryFor({
  id: 4,
  type: ITEM_TYPES.show,
  title: 'Severance',
  year: 2022,
})

const DUNE_POSTER: PosterEntry = (() => {
  const item = summaryFor({ id: 70, title: 'Dune', year: 2021 })
  return {
    media: mediaItemFor({ id: 50, libraryId: FILMS.id, title: 'Dune', item, favourite: true }),
    poster: item,
  }
})()

/** A favourite file no title was found for, so with no poster to stand on. */
const HOME_MOVIE: PosterEntry = {
  media: mediaItemFor({
    id: 51,
    libraryId: SERIES.id,
    title: 'Home Movie',
    fileName: 'Home Movie.mkv',
    favourite: true,
  }),
  poster: null,
}

/** What the server says when the favourites cannot be read. */
export const FAVOURITES_FAILURE = 'The server could not list the favourites.'

export type Favourites = {
  titles?: ItemSummary[]
  videos?: PosterEntry[]
  albums?: AlbumSummary[]
  artists?: Artist[]
  isFailing?: boolean
}

/** What the server holds unless a test says otherwise. */
const FAVOURITES: Required<Favourites> = {
  titles: [SEVERANCE],
  videos: [DUNE_POSTER, HOME_MOVIE],
  albums: [OK_COMPUTER],
  artists: [RADIOHEAD],
  isFailing: false,
}

type FavouritesApiProps = { read: () => Favourites }

/**
 * The four lists of the favourites, behind the app's allowlist so an unlisted call fails the
 * test: shows and seasons, videos, albums and artists, each read from `read` as it is asked
 * for, since the app keeps one client per server; each fails when `isFailing`.
 */
export const favouritesApi = ({ read }: FavouritesApiProps): ApiClient => {
  const answers = (): Record<string, unknown> => {
    const { titles, videos, albums, artists } = { ...FAVOURITES, ...read() }
    return {
      [APP_CLIENT_CALLS.listFavouriteTitles.path]: titles,
      [APP_CLIENT_CALLS.listFavourites.path]: videos,
      [APP_CLIENT_CALLS.listFavouriteAlbums.path]: albums,
      [APP_CLIENT_CALLS.listFavouriteArtists.path]: artists,
    }
  }
  const answerFor = (path: string): Answer => {
    const { isFailing } = { ...FAVOURITES, ...read() }
    const body = answers()[path]
    if (body === undefined) return NOT_FOUND
    return isFailing
      ? { status: STATUSES.failed, body: { message: FAVOURITES_FAILURE } }
      : { status: STATUSES.ok, body }
  }
  return createApiClient({
    baseUrl: NAS.origin,
    fetch: allowlistedFetch({
      fetch: async (url, init = {}) => {
        const [path = ''] = url.slice(NAS.origin.length).split('?')
        return init.method === undefined || init.method === APP_CALL_METHODS.get
          ? responseOf(answerFor(path))
          : responseOf(NOT_FOUND)
      },
    }),
  })
}
