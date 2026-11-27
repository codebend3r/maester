import {
  type AlbumDetails,
  type AlbumSummary,
  MATCH_STATES,
  type MediaItem,
  type Track,
} from '@raven/core'

import type { ListState } from '@/library/listState'

/** A music library's albums no MusicBrainz release was found for, as raven's Unmatched albums tab lists them. */
export const unmatchedAlbumsOf = (albums: readonly AlbumSummary[]): AlbumSummary[] =>
  albums.filter(({ match }) => match === MATCH_STATES.unmatched)

/** Entries of several libraries in the order each library sent them, one library after another. */
export const inLibraryOrder = <T>(entries: readonly T[]): T[] => [...entries]

/**
 * The albums a list of music files needs read to play them as tracks, each once, in the order
 * first met; a file that is no album's track needs none.
 */
export const albumIdsOf = (media: readonly MediaItem[]): number[] => [
  ...new Set(media.flatMap(({ album }) => (album === null ? [] : [album.id]))),
]

/** Where one album's page stands, as `useQueries` reports it. */
type AlbumRead = { data: AlbumDetails | undefined; error: Error | null; isSuccess: boolean }

type ListedTracksOfProps = {
  /** The files listed, by their media ids, in the list's order. */
  media: readonly Pick<MediaItem, 'id'>[]
  /** Where the listing of those files stands. */
  listing: ListState
  /** Each album `albumIdsOf` named, as it is read. */
  albums: readonly AlbumRead[]
}

/**
 * A list of music files as the tracks they are, in the list's order, each taken from its album's
 * page, so a row shows and plays the track the server keeps rather than one guessed from the
 * file; a file whose album has not answered, or that holds no such track, is left out. The list
 * is read once the files and every album are, and fails with the first failure of either.
 */
export const listedTracksOf = ({ media, listing, albums }: ListedTracksOfProps) => {
  const tracks = new Map(
    albums.flatMap(({ data }) => data?.tracks ?? []).map((track) => [track.id, track]),
  )
  const listed = media.flatMap(({ id }): Track[] => {
    const track = tracks.get(id)
    return track === undefined ? [] : [track]
  })
  return {
    tracks: listed,
    listing: {
      ...listing,
      failure: listing.failure ?? albums.find(({ error }) => error !== null)?.error ?? null,
      isRead: listing.isRead && albums.every(({ isSuccess }) => isSuccess),
    },
  }
}
