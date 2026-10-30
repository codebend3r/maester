import {
  ALBUM_TYPE_LABELS,
  type AlbumSummary,
  type AppPath,
  MUSIC_PAGE,
  type MusicSort,
  type PlaylistSummary,
  type Track,
  formatDuration,
} from '@raven/core'
import { api } from '@/lib/api'
import { COMMON_COPY, MUSIC_COPY } from '@/lib/copy'

/** An album's page: `/albums/:id`. */
export const albumPath = (albumId: number): AppPath => `/albums/${albumId}`

/** An artist's page: `/artists/:id`. */
export const artistPath = (artistId: number): AppPath => `/artists/${artistId}`

/** A playlist's page: `/playlists/:id`. */
export const playlistPath = (playlistId: number): AppPath => `/playlists/${playlistId}`

/** Now Playing, the full page over the bar. */
export const NOW_PLAYING_PATH: AppPath = '/now-playing'

/** The route a playlist's page answers on; `playlistPath` names one playlist's. */
export const PLAYLIST_ROUTE: AppPath = '/playlists/:id'

/** "4:03", or "1:02:03" past an hour; "" for an unknown length. */
export const trackLength = (seconds: number | null): string =>
  seconds === null ? '' : formatDuration(seconds)

type LengthFactsProps = { trackCount: number; duration: number }

/** How many tracks and how long they run: "12 tracks · 53 min", the minutes left out under one. */
const lengthFacts = ({ trackCount, duration }: LengthFactsProps): string[] => {
  const minutes = Math.round(duration / 60)
  return [COMMON_COPY.tracks(trackCount), ...(minutes > 0 ? [MUSIC_COPY.minutes(minutes)] : [])]
}

type AlbumFactsProps = { album: AlbumSummary }

/** The line under an album's title: "1997 · Album · 12 tracks · 53 min". */
export const albumFacts = ({ album }: AlbumFactsProps): string[] => [
  ...(album.year === null ? [] : [String(album.year)]),
  ALBUM_TYPE_LABELS[album.type],
  ...lengthFacts(album),
]

type PlaylistFactsProps = { playlist: PlaylistSummary }

/** The line under a playlist's name: "12 tracks · 53 min". */
export const playlistFacts = ({ playlist }: PlaylistFactsProps): string[] => lengthFacts(playlist)

type LibraryTracksProps = { libraryId: number; search: string; sort: MusicSort }

/** A library's tracks as its page lists them, as many as one page holds, for Play and Shuffle on the library. */
export const libraryTracks = async ({
  libraryId,
  search,
  sort,
}: LibraryTracksProps): Promise<Track[]> =>
  (await api.listTracks({ libraryId, search, sort, limit: MUSIC_PAGE.most })).tracks
