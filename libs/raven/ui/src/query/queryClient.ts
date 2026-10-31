import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query'
import {
  type MatchItemType,
  type MatchSubject,
  type MediaSort,
  type MixKind,
  type ViewingSession,
  ApiError,
  isLockedError,
} from '@raven/core'
import { playerQueryKeys } from '@/lib/playerQueryKeys'
import { useUnlockPrompt } from '@/stores/unlockPrompt'

/** Anything refused for sitting in a locked library asks for the PIN, wherever it was asked for. */
const askForPin = (error: Error): void => {
  if (isLockedError(error)) useUnlockPrompt.getState().ask()
}

/**
 * How long a library's listing stays cached once nothing shows it, so going
 * back to a library draws its cards at once instead of from a blank page.
 */
export const LISTING_GC_MS = 30 * 60_000

export const createQueryClient = (): QueryClient =>
  new QueryClient({
    queryCache: new QueryCache({ onError: askForPin }),
    mutationCache: new MutationCache({ onError: askForPin }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: true,
        // A 404 will not fix itself; anything else gets one more try.
        retry: (failures, error) =>
          !(error instanceof ApiError && error.status === 404) && failures < 1,
      },
    },
  })

type QueryKeysMediaProps = {
  libraryId: number
  search: string
  sort: MediaSort
  seed: number
}

type QueryKeysMusicListProps = { libraryId: number; search: string; sort: string }

type QueryKeysArtistsProps = { libraryId: number; search: string }

type QueryKeysRecentAlbumsProps = { libraryId: number; limit: number }

type QueryKeysSongsProps = { libraryIds: readonly number[]; search: string; sort: string }

type QueryKeysAlbumMatchSearchProps = { albumId: number; query: string }

type QueryKeysNextInSessionProps = { id: number; session: ViewingSession }

type QueryKeysShowsProps = {
  libraryId: number
  search: string
  sort: MediaSort
  seed: number
}

type QueryKeysHistoryProps = {
  libraryId: number | null
  show: string
  limit: number
}

type QueryKeysMatchSearchProps = {
  type: MatchItemType
  query: string
  year: number | null
  libraryId: number | null
  subject: MatchSubject | null
}

type QueryKeysItemImagesInProps = { id: number; libraryId: number }

/**
 * Every cache key, in one place. An id may be null for a query that waits on
 * it (`skipToken`); the key still names what it would hold.
 */
export const queryKeys = {
  ...playerQueryKeys,
  /** Everything the sign-in gate reads, one prefix to ask again together. */
  auth: ['auth'],
  authConfig: ['auth', 'config'],
  account: (userId: string | null) => ['auth', 'account', userId],
  /** Every account on this raven, as the owner who asked for them sees it. */
  members: (userId: string) => ['auth', 'members', userId],
  libraries: ['libraries'],
  library: (id: number | null) => ['libraries', id],
  media: ({ libraryId, search, sort, seed }: QueryKeysMediaProps) => [
    'libraries',
    libraryId,
    'media',
    { search, sort, seed },
  ],
  /** The prefix every media list of a library shares, whatever its search and sort. */
  mediaLists: (libraryId: number) => ['libraries', libraryId, 'media'],
  shows: ({ libraryId, search, sort, seed }: QueryKeysShowsProps) => [
    'libraries',
    libraryId,
    'shows',
    { search, sort, seed },
  ],
  /** The prefix a library's show listings share. */
  showLists: (libraryId: number) => ['libraries', libraryId, 'shows'],
  /** Every video's own queries: the item, its tracks, subtitles and location. */
  allMedia: ['media'],
  mediaItem: (id: number | null) => ['media', id],
  /** A video's intro, credits and chapters, for the player. */
  markers: (id: number | null) => ['media', id, 'markers'],
  /** Where a video's file lives, for its menu. */
  mediaLocation: (id: number) => ['media', id, 'location'],
  /** What plays after a video in a session, under the video's key so reading it again reads this again too. */
  nextInSession: ({ id, session }: QueryKeysNextInSessionProps) => ['media', id, 'next', session],
  favourites: ['favourites'],
  favouriteTitles: ['favourites', 'titles'],
  /** The account's favourite albums and artists, under the favourites so whatever reads them again reads these too. */
  favouriteAlbums: ['favourites', 'albums'],
  favouriteArtists: ['favourites', 'artists'],
  /** What is in progress and each pinned library's newest arrivals. */
  home: ['home'],
  /** A search from home, under home's key so whatever reads home again reads it again too. */
  homeSearch: (query: string) => ['home', 'search', query],
  homeSearches: ['home', 'search'],
  /** The hero's titles, under home's key so whatever reads home again reads them again too. */
  hero: ['home', 'hero'],
  /** The movies and shows the admin picked for the hero. */
  heroPicks: ['hero', 'picks'],
  history: ({ libraryId, show, limit }: QueryKeysHistoryProps) => [
    'libraries',
    libraryId,
    'history',
    { show, limit },
  ],
  /** The prefix every history of a library, or of all of them, shares. */
  historyLists: (libraryId: number | null) => ['libraries', libraryId, 'history'],
  /** How much each of a library's tabs holds, under the library's key so whatever reads the libraries again reads it again too. */
  libraryCounts: (libraryId: number) => ['libraries', libraryId, 'counts'],
  /** A library's tabs beside its listing: in progress, favourites, sagas, files not matched. */
  inProgress: (libraryId: number) => ['libraries', libraryId, 'in-progress'],
  libraryFavourites: (libraryId: number) => ['libraries', libraryId, 'favourites'],
  sagas: (libraryId: number | null) => ['libraries', libraryId, 'sagas'],
  unmatched: (libraryId: number) => ['libraries', libraryId, 'unmatched'],
  duplicates: (libraryId: number) => ['libraries', libraryId, 'duplicates'],
  browse: (path: string | null) => ['browse', path],
  /** Every item page shares this prefix, so a match or refresh refetches them all. */
  items: ['items'],
  item: (id: number | null) => ['items', id],
  /** Edit images: what an item could show, in every library. */
  itemImages: (id: number) => ['items', id, 'images'],
  /** Edit images: what an item could show in `libraryId`, the one shown there marked. */
  itemImagesIn: ({ id, libraryId }: QueryKeysItemImagesInProps) => [
    'items',
    id,
    'images',
    libraryId,
  ],
  /** Edit metadata: what the page shows against what TMDB says. */
  itemMetadata: (id: number) => ['items', id, 'metadata'],
  /** Whether locked libraries can be opened, and are, in this browser. */
  lock: ['lock'],
  /** Whether the admin lock holds in this browser. */
  adminLock: ['admin'],
  /** What the server is streaming to whom right now, for the admin. */
  liveStreams: ['streams'],
  /** What viewers reported from the player, for the admin. */
  bugReports: ['reports'],
  displaySettings: ['settings', 'display'],
  nextEpisode: (showId: number) => ['items', showId, 'next'],
  person: (id: number | null) => ['people', id],
  /** A music library's albums, artists and tracks, under the library so a library event reads them again. */
  albums: ({ libraryId, search, sort }: QueryKeysMusicListProps) => [
    'libraries',
    libraryId,
    'albums',
    { search, sort },
  ],
  artists: ({ libraryId, search }: QueryKeysArtistsProps) => [
    'libraries',
    libraryId,
    'artists',
    { search },
  ],
  /** A music library's newest albums, `limit` of them. */
  recentAlbums: ({ libraryId, limit }: QueryKeysRecentAlbumsProps) => [
    'libraries',
    libraryId,
    'albums',
    'recent',
    limit,
  ],
  /** Every album's and artist's page: one prefix a match or a scan reads again. */
  music: ['music'],
  /** The tracks of several music libraries, one after another: under the music, since a scan of any of them reads it again. */
  songs: ({ libraryIds, search, sort }: QueryKeysSongsProps) => [
    'music',
    'songs',
    { libraryIds, search, sort },
  ],
  /** The account's mixes for today, and each one's tracks, under the music so a scan reads them again. */
  mixes: ['music', 'mixes'],
  mix: (id: MixKind | null) => ['music', 'mixes', id],
  /** The albums the account played last and those added last, for the music mode's Home. */
  recentMusic: ['music', 'recent'],
  album: (id: number | null) => ['music', 'albums', id],
  artist: (id: number | null) => ['music', 'artists', id],
  /** A track's lyrics, under the music's prefix so a scan reads them again. */
  lyrics: (id: number | null) => ['music', 'tracks', id, 'lyrics'],
  /** The account's playlists, and each one's page under the same prefix. */
  playlists: ['playlists'],
  playlistList: ['playlists', 'list'],
  playlist: (id: number | null) => ['playlists', id],
  albumMatchSearch: ({ albumId, query }: QueryKeysAlbumMatchSearchProps) => [
    'music',
    'albums',
    albumId,
    'match',
    query,
  ],
  matchSearch: ({ type, query, year, libraryId, subject }: QueryKeysMatchSearchProps) => [
    'match',
    type,
    query,
    year,
    libraryId,
    subject?.kind ?? null,
    subject?.id ?? null,
  ],
  metadataHealth: ['health', 'metadata'],
}

/**
 * Keys for the changes shown before the server answers. Changes under one
 * key go to the server one at a time and are read again together, so it
 * covers every change that reads again the same caches.
 */
export const mutationKeys = {
  /** Any video's favourite: they all show in the same listings. */
  favourite: ['favourite'],
  /** Any show's or season's favourite: they all show on Favourites. */
  itemFavourite: ['item-favourite'],
  /** Any album's or artist's favourite: they all show in the same favourites. */
  musicFavourite: ['music-favourite'],
  /** Any rename or change of order of a playlist: the whole order is sent each time, so answers keep their order. */
  playlist: ['playlist'],
  /** Any mark as watched or unwatched: marks and their answers keep their order. */
  watched: ['watched'],
  /** Any library's pin: they all show in the libraries list and on home. */
  pin: ['pin'],
  /** Any library's place in the hero: they all show in the libraries list and in the hero. */
  heroLibrary: ['hero-library'],
  /** Any change to the libraries' order: the whole list is sent each time. */
  libraryOrder: ['library-order'],
  /** One library's sort, view or grouping, which only its page changes. */
  libraryView: (libraryId: number) => ['library-view', libraryId],
  playbackSettings: ['settings', 'playback'],
  displaySettings: ['settings', 'display'],
}
