import { type AlbumSummary, type Artist, type Library, MUSIC_SORTS, type Track } from '@raven/core'
import { useInfiniteQuery, useQueries, useQuery } from '@tanstack/react-query'
import { musicLibrariesOf } from '@/lib/music'
import { albumsQuery, artistsQuery, librariesQuery, songsQuery } from '@/lib/queries'

const NO_LIBRARIES: readonly Library[] = []

/** A list read from every music library: what it holds so far, and how the reading stands. */
export type MusicListing<T> = {
  entries: readonly T[]
  /** Whether every library's part has come. */
  isRead: boolean
  error: Error | null
  /** Whether the server holds no music library at all, once the libraries are read. */
  hasNoMusic: boolean
}

/** The server's music libraries, and whether they have been read. */
export const useMusicLibraries = () => {
  const libraries = useQuery(librariesQuery)
  return {
    libraries: musicLibrariesOf(libraries.data ?? NO_LIBRARIES),
    isRead: libraries.isSuccess,
    error: libraries.error,
  }
}

type Part<T> = { data?: readonly T[]; error: Error | null; isSuccess: boolean }

type MergedProps<T> = {
  music: ReturnType<typeof useMusicLibraries>
  parts: readonly Part<T>[]
  /** The entries' order once merged, and the key two libraries' copies of one entry share. */
  compare: (a: T, b: T) => number
  keyOf: (entry: T) => number
}

/** Every library's part as one list, each entry once, in `compare`'s order. */
const merged = <T>({ music, parts, compare, keyOf }: MergedProps<T>): MusicListing<T> => {
  const all = parts.flatMap((part) => part.data ?? [])
  const unique = [...new Map(all.map((entry) => [keyOf(entry), entry])).values()]
  return {
    entries: unique.toSorted(compare),
    isRead: music.isRead && parts.every((part) => part.isSuccess),
    error: music.error ?? parts.find((part) => part.error !== null)?.error ?? null,
    hasNoMusic: music.isRead && music.libraries.length === 0,
  }
}

/** What every music library is searched for; '' lists everything. */
type UseMusicSearchProps = { search: string }

type UseAllAlbumsProps = UseMusicSearchProps

/** Every music library's albums matching `search` ('' for all), by title. */
export const useAllAlbums = ({ search }: UseAllAlbumsProps): MusicListing<AlbumSummary> => {
  const music = useMusicLibraries()
  const parts = useQueries({
    queries: music.libraries.map((library) =>
      albumsQuery({ libraryId: library.id, search, sort: MUSIC_SORTS.title }),
    ),
  })
  return merged({
    music,
    parts,
    compare: (a, b) => a.sortTitle.localeCompare(b.sortTitle),
    keyOf: (album) => album.id,
  })
}

type UseAllArtistsProps = UseMusicSearchProps

/** Every music library's artists matching `search` ('' for all), each once, by name. */
export const useAllArtists = ({ search }: UseAllArtistsProps): MusicListing<Artist> => {
  const music = useMusicLibraries()
  const parts = useQueries({
    queries: music.libraries.map((library) => artistsQuery({ libraryId: library.id, search })),
  })
  return merged({
    music,
    parts,
    compare: (a, b) => a.sortName.localeCompare(b.sortName),
    keyOf: (artist) => artist.id,
  })
}

type UseAllSongsProps = UseMusicSearchProps

/** Every music library's tracks matching `search` ('' for all), by title, a page at a time. */
export const useAllSongs = ({ search }: UseAllSongsProps) => {
  const music = useMusicLibraries()
  const songs = useInfiniteQuery(
    songsQuery({
      libraryIds: music.libraries.map(({ id }) => id),
      search,
      sort: MUSIC_SORTS.title,
    }),
  )
  const tracks: readonly Track[] = songs.data?.pages.flatMap((page) => page.tracks) ?? []
  return {
    tracks,
    isRead: songs.isSuccess || (music.isRead && music.libraries.length === 0),
    error: music.error ?? songs.error,
    hasNoMusic: music.isRead && music.libraries.length === 0,
    hasMore: songs.hasNextPage,
    isLoadingMore: songs.isFetchingNextPage,
    loadMore: () => void songs.fetchNextPage(),
  }
}
