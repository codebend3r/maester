import { plural } from '@raven/core'
import { COUNTS_COPY, KIT_COPY } from '@/copy/kit'
import type { ListState } from '@/library/listState'

/** One of Favourites' lists: how many it holds and where its listing stands. */
type FavouriteList = { count: number; listing: ListState }

type FavouritesOfProps = { artists: FavouriteList; albums: FavouriteList; tracks: FavouriteList }

/** What Favourites shows above its lists: their state as one list's, whether all are empty, and the count line. */
type Favourites = { listing: ListState; isEmpty: boolean; countLine: string | null }

/**
 * Favourites' artists, albums and songs as one page: the first failure and whether all have
 * answered, and the counts of the lists that hold something, said once all are read.
 */
export const favouritesOf = ({ artists, albums, tracks }: FavouritesOfProps): Favourites => {
  const listing = {
    failure: tracks.listing.failure ?? albums.listing.failure ?? artists.listing.failure,
    isRead: tracks.listing.isRead && albums.listing.isRead && artists.listing.isRead,
    hasNoMusic: tracks.listing.hasNoMusic,
  }
  const counts = [
    { n: artists.count, ...COUNTS_COPY.artists },
    { n: albums.count, ...COUNTS_COPY.albums },
    { n: tracks.count, ...COUNTS_COPY.songs },
  ]
    .filter(({ n }) => n > 0)
    .map(plural)
  const isEmpty = counts.length === 0
  const isCounted = listing.isRead && listing.failure === null && !isEmpty
  return { listing, isEmpty, countLine: isCounted ? KIT_COPY.facts(counts) : null }
}
