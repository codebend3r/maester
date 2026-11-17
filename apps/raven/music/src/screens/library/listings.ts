import { MUSIC_SORTS } from '@raven/core'
import { useQueries, useQuery } from '@tanstack/react-query'

import { useDownloads } from '@/downloads/downloadStore'
import { byName, byTitle, mergedOf } from '@/music/merged'
import { useMusicLibraries } from '@/music/musicLibraries'
import { downloadsSummaryOf } from '@/screens/library/downloadRows'
import { newestAlbums } from '@/screens/library/sorts'
import type { WrenSession } from '@/useWren'

/** How many of a library's newest albums Home and Library ask for. */
const RECENT_ALBUMS = 20

type ListingsProps = {
  session: WrenSession
  /** What the server finds them by; blank for every one. */
  search: string
  /** Whether to ask at all: a search asks only once something is typed. */
  isEnabled?: boolean
}

/** Every music library's albums that `search` finds as one list, by title, and where it stands. */
export const useAllAlbums = ({ session, search, isEnabled = true }: ListingsProps) => {
  const music = useMusicLibraries(session)
  const listings = useQueries({
    queries: music.libraries.map((library) => ({
      ...session.queries.albumsQuery({ libraryId: library.id, search, sort: MUSIC_SORTS.title }),
      enabled: isEnabled,
    })),
  })
  const { entries, ...listing } = mergedOf({
    music,
    listings,
    order: (found) => found.toSorted(byTitle),
  })
  return { albums: entries, listing }
}

/** Every music library's artists that `search` finds as one list, each once, by name, and where it stands. */
export const useAllArtists = ({ session, search, isEnabled = true }: ListingsProps) => {
  const music = useMusicLibraries(session)
  const listings = useQueries({
    queries: music.libraries.map((library) => ({
      ...session.queries.artistsQuery({ libraryId: library.id, search }),
      enabled: isEnabled,
    })),
  })
  const { entries, ...listing } = mergedOf({ music, listings, order: byName })
  return { artists: entries, listing, music }
}

/** The newest albums of every music library together, newest first, and where they stand. */
export const useRecentAlbums = (session: WrenSession) => {
  const music = useMusicLibraries(session)
  const listings = useQueries({
    queries: music.libraries.map((library) =>
      session.queries.recentAlbumsQuery({ libraryId: library.id, limit: RECENT_ALBUMS }),
    ),
  })
  const { entries, ...listing } = mergedOf({
    music,
    listings,
    order: (albums) => newestAlbums({ albums, limit: RECENT_ALBUMS }),
  })
  return { albums: entries, listing, music }
}

type UseSongCountProps = { session: WrenSession; search: string }

/**
 * How many songs every music library holds that `search` finds, added up from each library's
 * total, which a page of one track carries; null until every library has answered, or when one
 * could not, so a count is never guessed.
 */
export const useSongCount = ({ session, search }: UseSongCountProps): number | null => {
  const music = useMusicLibraries(session)
  const counts = useQueries({
    queries: music.libraries.map((library) =>
      session.queries.songCountQuery({ libraryId: library.id, search }),
    ),
  })
  if (!music.isRead || !counts.every(({ isSuccess }) => isSuccess)) return null
  return counts.reduce((sum, { data }) => sum + (data ?? 0), 0)
}

/** The account's playlists and the shared ones. */
export const usePlaylists = (session: WrenSession) => useQuery(session.queries.playlistsQuery)

/** What is downloaded from the active server: its albums, playlists and bytes. */
export const useDownloadsSummary = (serverId: string) => {
  const entries = useDownloads((state) => state.entries)
  const playlists = useDownloads((state) => state.playlists)
  return downloadsSummaryOf({ entries, playlists, serverId })
}
