import { type Library, MUSIC_SORTS, type MediaItem, type Track } from '@raven/core'
import {
  albumIdsOf,
  albumsByTitle,
  artistsByName,
  finishedSongsOf,
  inLibraryOrder,
  inProgressSongsOf,
  libraryValuesOf,
  type ListOrder,
  type ListState,
  listStateOf,
  listedTracksOf,
  mergedOf,
  nextPageOf,
  RECENT_SERVER_SORTS,
  type RecentSort,
  recentAlbums,
  songAlbumIdsOf,
  songCountOf,
  songCountsOf,
  tracksOfPages,
  unmatchedAlbumsOf,
} from '@raven/wren'
import {
  type QueryKey,
  type UseQueryOptions,
  useInfiniteQuery,
  useQueries,
  useQuery,
} from '@tanstack/react-query'

import { useMusicLibraries } from '@/music/musicLibraries'
import { useSongProgress } from '@/stores/songProgress'
import { type WrenSession } from '@/useWren'

/** The query one music library is asked. */
type PerLibrary<Answer, Data, Key extends QueryKey> = (
  library: Library,
) => UseQueryOptions<Answer, Error, Data, Key>

type UsePerLibraryProps<Answer, Data, Key extends QueryKey> = {
  session: WrenSession
  build: PerLibrary<Answer, Data, Key>
}

/** The music libraries, and what each answers to the query `build` makes for it. */
const usePerLibrary = <Answer, Data, Key extends QueryKey>({
  session,
  build,
}: UsePerLibraryProps<Answer, Data, Key>) => {
  const music = useMusicLibraries(session)
  const listings = useQueries({ queries: music.libraries.map(build) })
  return { music, listings }
}

type UseMergedListingProps<Answer, Entry, Key extends QueryKey> = UsePerLibraryProps<
  Answer,
  Entry[],
  Key
> & {
  /** How entries from several libraries are put in one order. */
  order: (entries: readonly Entry[]) => Entry[]
}

/** Every music library's answer to `build` as one list in `order`, and where that list stands. */
const useMergedListing = <Answer, Entry, Key extends QueryKey>({
  session,
  build,
  order,
}: UseMergedListingProps<Answer, Entry, Key>) => {
  const { music, listings } = usePerLibrary({ session, build })
  const { entries, ...listing } = mergedOf({ music, listings, order })
  return { entries, listing }
}

type ListingsProps = {
  session: WrenSession
  /** What the server finds them by; blank for every one. */
  search: string
  /** Whether to ask at all: a search asks only once something is typed. */
  isEnabled?: boolean
}

/** Every music library's albums that `search` finds as one list, by title, and where it stands. */
export const useAllAlbums = ({ session, search, isEnabled = true }: ListingsProps) => {
  const { entries, listing } = useMergedListing({
    session,
    build: (library) => ({
      ...session.queries.albumsQuery({ libraryId: library.id, search, sort: MUSIC_SORTS.title }),
      enabled: isEnabled,
    }),
    order: albumsByTitle,
  })
  return { albums: entries, listing }
}

/** Every music library's artists that `search` finds as one list, each once, by name, and where it stands. */
export const useAllArtists = ({ session, search, isEnabled = true }: ListingsProps) => {
  const { entries, listing } = useMergedListing({
    session,
    build: (library) => ({
      ...session.queries.artistsQuery({ libraryId: library.id, search }),
      enabled: isEnabled,
    }),
    order: artistsByName,
  })
  return { artists: entries, listing }
}

type UseRecentAlbumsProps = {
  session: WrenSession
  /** What makes an album recent. */
  sort: RecentSort
  /** How many to show, and to ask each library for. */
  limit: number
}

/** The newest albums of every music library together by `sort`, newest first, and where they stand. */
export const useRecentAlbums = ({ session, sort, limit }: UseRecentAlbumsProps) => {
  const { entries, listing } = useMergedListing({
    session,
    build: (library) =>
      session.queries.recentAlbumsQuery({
        libraryId: library.id,
        limit,
        sort: RECENT_SERVER_SORTS[sort],
      }),
    order: (albums) => recentAlbums({ albums, sort, limit }),
  })
  return { albums: entries, listing }
}

type UseSongCountProps = { session: WrenSession; search: string }

/**
 * How many songs every music library holds that `search` finds, added up from each library's
 * total, which a page of one track carries; null until every library has answered, or when one
 * could not, so a count is never guessed.
 */
export const useSongCount = ({ session, search }: UseSongCountProps): number | null => {
  const { music, listings } = usePerLibrary({
    session,
    build: (library) => session.queries.songCountQuery({ libraryId: library.id, search }),
  })
  return songCountOf({ music, counts: listings })
}

const NO_TRACKS: readonly Track[] = []

type UseAllSongsProps = ListingsProps & {
  /** The order the server pages them in, and the seed it deals a random one by. */
  order: ListOrder
}

/**
 * Every music library's songs that `search` finds, a page at a time in the order `order` names:
 * what is read so far, where the list stands, and `nextPage`, which a list calls near its end.
 */
export const useAllSongs = ({ session, search, order, isEnabled = true }: UseAllSongsProps) => {
  const music = useMusicLibraries(session)
  const songs = useInfiniteQuery({
    ...session.queries.songsQuery({
      libraryIds: music.libraries.map(({ id }) => id),
      search,
      sort: order.sort,
      seed: order.seed,
    }),
    enabled: isEnabled,
  })
  return {
    tracks: songs.data === undefined ? NO_TRACKS : tracksOfPages(songs.data.pages),
    listing: listStateOf({ music, failure: songs.error, isRead: songs.isSuccess }),
    nextPage: nextPageOf(songs),
  }
}

/** The account's playlists and the shared ones. */
export const usePlaylists = (session: WrenSession) => useQuery(session.queries.playlistsQuery)

/**
 * Every music library's albums no MusicBrainz release was found for, as one list by title, and
 * where it stands: Albums' own listing, so the two share what the server sent.
 */
export const useUnmatchedAlbums = (session: WrenSession) => {
  const { entries, listing } = useMergedListing({
    session,
    build: (library) => ({
      ...session.queries.albumsQuery({
        libraryId: library.id,
        search: '',
        sort: MUSIC_SORTS.title,
      }),
      select: unmatchedAlbumsOf,
    }),
    order: albumsByTitle,
  })
  return { albums: entries, listing }
}

type UseListedTracksProps = {
  session: WrenSession
  media: readonly MediaItem[]
  listing: ListState
}

/** Music files as the tracks they are, read from their albums' pages, and where the list stands. */
const useListedTracks = ({ session, media, listing }: UseListedTracksProps) => {
  const albums = useQueries({
    queries: albumIdsOf(media).map((id) => session.queries.albumQuery(id)),
  })
  return listedTracksOf({ media, listing, albums })
}

/** Picks some of this device's songs, of the server and libraries worn: In progress's or Recently finished's. */
type SongsPick = typeof inProgressSongsOf

type UseDeviceSongsProps = { session: WrenSession; pick: SongsPick }

/**
 * Songs this device keeps the progress of, as `pick` lists them from the music libraries worn,
 * each the track its album's page holds; read once the libraries and those albums are.
 */
const useDeviceSongs = ({ session, pick }: UseDeviceSongsProps) => {
  const music = useMusicLibraries(session)
  const kept = useSongProgress((state) => state.songs)
  const songs = pick({
    songs: kept,
    serverId: session.server.id,
    libraryIds: music.libraries.map(({ id }) => id),
  })
  const albums = useQueries({
    queries: songAlbumIdsOf(songs).map((id) => session.queries.albumQuery(id)),
  })
  return listedTracksOf({
    media: songs.map(({ trackId }) => ({ id: trackId })),
    listing: listStateOf({ music, failure: null, isRead: true }),
    albums,
  })
}

/** The songs left partway through on this device, in the libraries worn, the most recently left first. */
export const useInProgressTracks = (session: WrenSession) =>
  useDeviceSongs({ session, pick: inProgressSongsOf })

const NO_ENTRIES: readonly never[] = []

type UseAccountListingProps<Entry, Key extends QueryKey> = {
  session: WrenSession
  query: UseQueryOptions<Entry[], Error, Entry[], Key>
}

/** A list the account keeps across every music library, and where it stands beside them. */
const useAccountListing = <Entry, Key extends QueryKey>({
  session,
  query,
}: UseAccountListingProps<Entry, Key>) => {
  const music = useMusicLibraries(session)
  const answer = useQuery(query)
  const entries: readonly Entry[] = answer.data ?? NO_ENTRIES
  return {
    entries,
    listing: listStateOf({ music, failure: answer.error, isRead: answer.isSuccess }),
  }
}

/** The artists the account marked a favourite, most recently marked first, and where they stand. */
export const useFavouriteArtists = (session: WrenSession) => {
  const { entries, listing } = useAccountListing({
    session,
    query: session.queries.favouriteArtistsQuery,
  })
  return { artists: entries, listing }
}

/** The albums the account marked a favourite, most recently marked first, and where they stand. */
export const useFavouriteAlbums = (session: WrenSession) => {
  const { entries, listing } = useAccountListing({
    session,
    query: session.queries.favouriteAlbumsQuery,
  })
  return { albums: entries, listing }
}

/** The songs marked a favourite in every music library, each library's most recently marked first. */
export const useFavouriteTracks = (session: WrenSession) => {
  const { entries, listing } = useMergedListing({
    session,
    build: (library) => session.queries.libraryFavouritesQuery(library.id),
    order: inLibraryOrder,
  })
  return useListedTracks({ session, media: entries.map(({ media }) => media), listing })
}

/** The songs played to their end on this device, in the libraries worn, the newest first. */
export const useFinishedTracks = (session: WrenSession) =>
  useDeviceSongs({ session, pick: finishedSongsOf })

/**
 * What each category the web shares holds, added up over every music library from the server's
 * counts, the playlists and the songs, and In progress and Recently finished from this device's
 * own; a count still on its way, failed or none is left out.
 */
export const useLibraryValues = (session: WrenSession) => {
  const { music, listings } = usePerLibrary({
    session,
    build: (library) => session.queries.libraryCountsQuery(library.id),
  })
  const playlists = usePlaylists(session)
  const songs = useSongCount({ session, search: '' })
  const kept = useSongProgress((state) => state.songs)
  return libraryValuesOf({
    music,
    counts: listings,
    playlists: playlists.data?.length ?? null,
    songs,
    progress: songCountsOf({
      songs: kept,
      serverId: session.server.id,
      libraryIds: music.libraries.map(({ id }) => id),
    }),
  })
}
