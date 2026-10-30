import {
  ALBUM_TYPE_LABELS,
  type AlbumSummary,
  type AppPath,
  MUSIC_PAGE,
  type MusicSort,
  type Track,
  formatDuration,
} from '@raven/core'
import { api } from '@/lib/api'

/** An album's page: `/albums/:id`. */
export const albumPath = (albumId: number): AppPath => `/albums/${albumId}`

/** An artist's page: `/artists/:id`. */
export const artistPath = (artistId: number): AppPath => `/artists/${artistId}`

/** Now Playing, the full page over the bar. */
export const NOW_PLAYING_PATH: AppPath = '/now-playing'

/** "4:03", or "1:02:03" past an hour; "" for an unknown length. */
export const trackLength = (seconds: number | null): string =>
  seconds === null ? '' : formatDuration(seconds)

type AlbumFactsProps = { album: AlbumSummary }

/** The line under an album's title: "1997 · Album · 12 tracks · 53 min". */
export const albumFacts = ({ album }: AlbumFactsProps): string[] => {
  const minutes = Math.round(album.duration / 60)
  return [
    ...(album.year === null ? [] : [String(album.year)]),
    ALBUM_TYPE_LABELS[album.type],
    `${album.trackCount} ${album.trackCount === 1 ? 'track' : 'tracks'}`,
    ...(minutes > 0 ? [`${minutes} min`] : []),
  ]
}

type LibraryTracksProps = { libraryId: number; search: string; sort: MusicSort }

/** A library's tracks as its page lists them, as many as one page holds, for Play and Shuffle on the library. */
export const libraryTracks = async ({
  libraryId,
  search,
  sort,
}: LibraryTracksProps): Promise<Track[]> =>
  (await api.listTracks({ libraryId, search, sort, limit: MUSIC_PAGE.most })).tracks
