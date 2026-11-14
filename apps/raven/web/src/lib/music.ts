import {
  ALBUM_TYPE_LABELS,
  type AlbumSummary,
  type AppPath,
  MUSIC_PAGE,
  type MixKind,
  type MixSummary,
  type MusicSort,
  type PlaylistSummary,
  type Track,
  formatDuration,
  albumDateLabel,
  type MusicListOptions,
} from '@raven/core'
import { generatePath, matchPath } from 'react-router-dom'
import { api } from '@/lib/api'
import { COMMON_COPY, MUSIC_COPY } from '@/lib/copy'

/** Now Playing, the full page over the bar. */
export const NOW_PLAYING_PATH: AppPath = '/now-playing'

/** The route a playlist's page answers on; `playlistPath` names one playlist's. */
export const PLAYLIST_ROUTE: AppPath = '/playlists/:id'

/**
 * The music mode's pages, under `/music`: Home, the library's four lists,
 * the album, artist and playlist pages raven's own mode shows too, a mix,
 * Now Playing, the music search and, in Raven, the downloads.
 */
export const MUSIC_PATHS = {
  root: '/music',
  albums: '/music/albums',
  artists: '/music/artists',
  noArtwork: '/music/no-artwork',
  songs: '/music/songs',
  playlists: '/music/playlists',
  album: '/music/albums/:id',
  artist: '/music/artists/:id',
  playlist: '/music/playlists/:id',
  mix: '/music/mixes/:id',
  nowPlaying: '/music/now-playing',
  search: '/music/search',
  downloads: '/music/downloads',
} as const satisfies Record<string, AppPath>

/** A mix's page: `/music/mixes/:id`, its kind the id. */
export const mixPath = (kind: MixKind): string => generatePath(MUSIC_PATHS.mix, { id: kind })

/** Whether `pathname` is one of the music mode's pages, under `/music`. */
export const isMusicPath = (pathname: string): boolean =>
  matchPath({ path: MUSIC_PATHS.root, end: false }, pathname) !== null

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
  ...[albumDateLabel(album)].filter((date) => date !== null),
  ALBUM_TYPE_LABELS[album.type],
  ...lengthFacts(album),
]

type MixFactsProps = { mix: MixSummary }

/** The line under a mix's name: "50 tracks · 200 min". */
export const mixFacts = ({ mix }: MixFactsProps): string[] => lengthFacts(mix)

type PlaylistFactsProps = { playlist: PlaylistSummary }

/** The line under a playlist's name: "12 tracks · 53 min". */
export const playlistFacts = ({ playlist }: PlaylistFactsProps): string[] => lengthFacts(playlist)

type LibraryTracksProps = { libraryId: number; search: string; sort: MusicSort } & Pick<
  MusicListOptions,
  'order' | 'seed'
>

/** A library's tracks as its page lists them, as many as one page holds, for Play and Shuffle on the library. */
export const libraryTracks = async (options: LibraryTracksProps): Promise<Track[]> => {
  const listing = { ...options, byAlbum: true, limit: MUSIC_PAGE.most }
  const page = await api.listTracks(listing)
  const pages = Math.ceil(page.total / MUSIC_PAGE.most)
  // The total is known from the first page, so the rest are asked for together and kept in order.
  const rest = await Promise.all(
    Array.from({ length: Math.max(0, pages - 1) }, (_, index) =>
      api.listTracks({ ...listing, offset: (index + 1) * MUSIC_PAGE.most }),
    ),
  )
  return [...page.tracks, ...rest.flatMap((more) => more.tracks)]
}
