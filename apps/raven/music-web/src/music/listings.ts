import { type Library, MUSIC_SORTS, type Track } from '@raven/core'
import {
  type ListSort,
  RECENT_SERVER_SORTS,
  type RecentSort,
  SERVER_SORTS,
  albumsByTitle,
  artistsByName,
  listStateOf,
  mergedOf,
  nextPageOf,
  recentAlbums,
  songCountOf,
  tracksOfPages,
} from '@raven/wren'
import {
  type QueryKey,
  type UseQueryOptions,
  useInfiniteQuery,
  useQueries,
  useQuery,
} from '@tanstack/react-query'
import { queries } from '@/lib/queries'
import { useMusicLibraries } from '@/music/musicLibraries'

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
  /** The order the server pages them in. */
  sort: ListSort
}

/**
 * Every music library's songs that `search` finds, a page at a time in the order `sort` names:
 * what is read so far, where the list stands, and `nextPage`, which a list calls near its end.
 */
export const useAllSongs = ({ search, sort, isEnabled = true }: UseAllSongsProps) => {
  const music = useMusicLibraries()
  const songs = useInfiniteQuery({
    ...queries.songsQuery({
      libraryIds: music.libraries.map(({ id }) => id),
      search,
      sort: SERVER_SORTS[sort],
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
