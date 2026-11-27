import { type Library, MUSIC_SORTS, type MediaItem, type Track } from '@raven/core'
import {
  type ListOrder,
  type ListState,
  RECENT_SERVER_SORTS,
  type RecentSort,
  albumIdsOf,
  albumsByTitle,
  artistsByName,
  finishedSongsOf,
  inLibraryOrder,
  inProgressSongsOf,
  libraryValuesOf,
  listStateOf,
  listedTracksOf,
  mergedOf,
  nextPageOf,
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
import { queries } from '@/lib/queries'
import { serverAddress } from '@/lib/serverAddress'
import { useMusicLibraries } from '@/music/musicLibraries'
import { useSongProgress } from '@/stores/songProgress'

/** The query one music library is asked. */
type PerLibrary<Answer, Data, Key extends QueryKey> = (
  library: Library,
) => UseQueryOptions<Answer, Error, Data, Key>

/** The music libraries, and what each answers to the query `build` makes for it. */
const usePerLibrary = <Answer, Data, Key extends QueryKey>(
  build: PerLibrary<Answer, Data, Key>,
) => {
  const music = useMusicLibraries()
  const listings = useQueries({ queries: music.libraries.map(build) })
  return { music, listings }
}

type ListingsProps = {
  /** What the server finds them by; blank for every one. */
  search: string
  /** Whether to ask at all: a search asks only once something is typed. */
  isEnabled?: boolean
}

/** Every music library's albums that `search` finds as one list, by title, and where it stands. */
export const useAllAlbums = ({ search, isEnabled = true }: ListingsProps) => {
  const { music, listings } = usePerLibrary((library) => ({
    ...queries.albumsQuery({ libraryId: library.id, search, sort: MUSIC_SORTS.title }),
    enabled: isEnabled,
  }))
  const { entries, ...listing } = mergedOf({ music, listings, order: albumsByTitle })
  return { albums: entries, listing }
}

/** Every music library's artists that `search` finds as one list, each once, by name, and where it stands. */
export const useAllArtists = ({ search, isEnabled = true }: ListingsProps) => {
  const { music, listings } = usePerLibrary((library) => ({
    ...queries.artistsQuery({ libraryId: library.id, search }),
    enabled: isEnabled,
  }))
  const { entries, ...listing } = mergedOf({ music, listings, order: artistsByName })
  return { artists: entries, listing }
}

type UseRecentAlbumsProps = {
  /** What makes an album recent. */
  sort: RecentSort
  /** How many to show, and to ask each library for. */
  limit: number
}

/** The newest albums of every music library together by `sort`, newest first, and where they stand. */
export const useRecentAlbums = ({ sort, limit }: UseRecentAlbumsProps) => {
  const { music, listings } = usePerLibrary((library) =>
    queries.recentAlbumsQuery({ libraryId: library.id, limit, sort: RECENT_SERVER_SORTS[sort] }),
  )
  const { entries, ...listing } = mergedOf({
    music,
    listings,
    order: (albums) => recentAlbums({ albums, sort, limit }),
  })
  return { albums: entries, listing }
}

type UseSongCountProps = { search: string }

/**
 * How many songs every music library holds that `search` finds, added up from each library's
 * total, which a page of one track carries; null until every library has answered, or when one
 * could not, so a count is never guessed.
 */
export const useSongCount = ({ search }: UseSongCountProps): number | null => {
  const { music, listings } = usePerLibrary((library) =>
    queries.songCountQuery({ libraryId: library.id, search }),
  )
  return songCountOf({ music, counts: listings })
}

const NO_TRACKS: readonly Track[] = []

type UseAllSongsProps = ListingsProps & {
  /** The order the server pages them in, and the seed a random one is dealt by. */
  order: ListOrder
}

/**
 * Every music library's songs that `search` finds, a page at a time in the order `order` names:
 * what is read so far, where the list stands, and `nextPage`, which a list calls near its end.
 */
export const useAllSongs = ({ search, order, isEnabled = true }: UseAllSongsProps) => {
  const music = useMusicLibraries()
  const songs = useInfiniteQuery({
    ...queries.songsQuery({
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
export const usePlaylists = () => useQuery(queries.playlistsQuery)

/**
 * Every music library's albums no MusicBrainz release was found for, as one list by title, and
 * where it stands: Albums' own listing, so the two share what the server sent.
 */
export const useUnmatchedAlbums = () => {
  const { music, listings } = usePerLibrary((library) => ({
    ...queries.albumsQuery({ libraryId: library.id, search: '', sort: MUSIC_SORTS.title }),
    select: unmatchedAlbumsOf,
  }))
  const { entries, ...listing } = mergedOf({ music, listings, order: albumsByTitle })
  return { albums: entries, listing }
}

type UseListedTracksProps = { media: readonly MediaItem[]; listing: ListState }

/** Music files as the tracks they are, read from their albums' pages, and where the list stands. */
const useListedTracks = ({ media, listing }: UseListedTracksProps) => {
  const albums = useQueries({ queries: albumIdsOf(media).map((id) => queries.albumQuery(id)) })
  return listedTracksOf({ media, listing, albums })
}

/** Picks some of this browser's songs, of the server and libraries worn: In progress's or Recently finished's. */
type SongsPick = typeof inProgressSongsOf

/**
 * Songs this browser keeps the progress of, as `pick` lists them from the music libraries worn,
 * each the track its album's page holds; read once the libraries and those albums are.
 */
const useDeviceSongs = (pick: SongsPick) => {
  const music = useMusicLibraries()
  const kept = useSongProgress((state) => state.songs)
  const songs = pick({
    songs: kept,
    serverId: serverAddress(),
    libraryIds: music.libraries.map(({ id }) => id),
  })
  const albums = useQueries({ queries: songAlbumIdsOf(songs).map((id) => queries.albumQuery(id)) })
  return listedTracksOf({
    media: songs.map(({ trackId }) => ({ id: trackId })),
    listing: listStateOf({ music, failure: null, isRead: true }),
    albums,
  })
}

/** The songs left partway through in this browser, in the libraries worn, the most recently left first. */
export const useInProgressTracks = () => useDeviceSongs(inProgressSongsOf)

/** The songs marked a favourite in every music library, each library's most recently marked first. */
export const useFavouriteTracks = () => {
  const { music, listings } = usePerLibrary((library) => queries.libraryFavouritesQuery(library.id))
  const { entries, ...listing } = mergedOf({ music, listings, order: inLibraryOrder })
  return useListedTracks({ media: entries.map(({ media }) => media), listing })
}

const NO_ENTRIES: readonly never[] = []

/*
 * A list the account keeps across every music library: its entries, none while it is read, and
 * where it stands beside the libraries.
 */
const useAccountList = <Entry, Key extends QueryKey>(
  query: UseQueryOptions<Entry[], Error, Entry[], Key>,
) => {
  const music = useMusicLibraries()
  const answer = useQuery(query)
  const entries: readonly Entry[] = answer.data ?? NO_ENTRIES
  return {
    entries,
    listing: listStateOf({ music, failure: answer.error, isRead: answer.isSuccess }),
  }
}

/** The artists the account marked a favourite, most recently marked first, and where they stand. */
export const useFavouriteArtists = () => {
  const { entries, listing } = useAccountList(queries.favouriteArtistsQuery)
  return { artists: entries, listing }
}

/** The albums the account marked a favourite, most recently marked first, and where they stand. */
export const useFavouriteAlbums = () => {
  const { entries, listing } = useAccountList(queries.favouriteAlbumsQuery)
  return { albums: entries, listing }
}

/** The songs played to their end in this browser, in the libraries worn, the newest first. */
export const useFinishedTracks = () => useDeviceSongs(finishedSongsOf)

/**
 * What each of Library's categories holds, added up over every music library from the server's
 * counts, the playlists and the songs, and In progress and Recently finished from this browser's
 * own; a count still on its way, failed or none is left out.
 */
export const useLibraryValues = () => {
  const { music, listings } = usePerLibrary((library) => queries.libraryCountsQuery(library.id))
  const playlists = usePlaylists()
  const songs = useSongCount({ search: '' })
  const kept = useSongProgress((state) => state.songs)
  return libraryValuesOf({
    music,
    counts: listings,
    playlists: playlists.data?.length ?? null,
    songs,
    progress: songCountsOf({
      songs: kept,
      serverId: serverAddress(),
      libraryIds: music.libraries.map(({ id }) => id),
    }),
  })
}
