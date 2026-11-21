import { type Library, MUSIC_SORTS, type Track } from '@raven/core'
import {
  albumsByTitle,
  artistsByName,
  type ListSort,
  listStateOf,
  mergedOf,
  nextPageOf,
  RECENT_SERVER_SORTS,
  type RecentSort,
  recentAlbums,
  SERVER_SORTS,
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

import { useDownloads } from '@/downloads/downloadStore'
import { useMusicLibraries } from '@/music/musicLibraries'
import { downloadsSummaryOf } from '@/screens/library/downloadRows'
import type { WrenSession } from '@/useWren'

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
  /** The order the server pages them in. */
  sort: ListSort
}

/**
 * Every music library's songs that `search` finds, a page at a time in the order `sort` names:
 * what is read so far, where the list stands, and `nextPage`, which a list calls near its end.
 */
export const useAllSongs = ({ session, search, sort, isEnabled = true }: UseAllSongsProps) => {
  const music = useMusicLibraries(session)
  const songs = useInfiniteQuery({
    ...session.queries.songsQuery({
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
export const usePlaylists = (session: WrenSession) => useQuery(session.queries.playlistsQuery)

/** What is downloaded from the active server: its albums, playlists and bytes. */
export const useDownloadsSummary = (serverId: string) => {
  const entries = useDownloads((state) => state.entries)
  const playlists = useDownloads((state) => state.playlists)
  return downloadsSummaryOf({ entries, playlists, serverId })
}
