import { QUEUE_SOURCE_KINDS, type QueueSource, artistNames } from '@raven/core'
import { BROWSE_KINDS, type BrowseTarget, browseIdOf } from '@raven/native/headless'
import { playlistFactsOf, useAudioQueue } from '@raven/ui/headless'
import type { ReactElement } from 'react'
import { FlatList } from 'react-native'

import { ListRow } from '@/components/ListRow'
import { Notice } from '@/components/Notice'
import { pageStyles, useListContent } from '@/components/TabPage'
import { downloadedLibraryOf, useDownloads } from '@/downloads/downloadStore'
import { LIBRARY_PAGE_COPY } from '@/screens/copy'

/** One downloaded album or playlist as its row shows it, and what it plays. */
type DownloadedRow = {
  title: string
  line: string
  target: BrowseTarget
  source: QueueSource
}

type DownloadsListProps = { serverId: string; header: ReactElement }

/**
 * Library's Downloads: the albums, then the playlists, downloaded from this server, read from
 * the device alone, so the list plays with the server out of reach. A row plays its tracks from
 * their files.
 */
export function DownloadsList({ serverId, header }: DownloadsListProps) {
  const content = useListContent()
  const entries = useDownloads((state) => state.entries)
  const playlists = useDownloads((state) => state.playlists)
  const playTracks = useAudioQueue((store) => store.playTracks)
  const library = downloadedLibraryOf({ entries, playlists, serverId })
  const rows: DownloadedRow[] = [
    ...library.albums().map((album) => ({
      title: album.title,
      line: artistNames(album),
      target: { kind: BROWSE_KINDS.album, albumId: album.id } as const,
      source: { kind: QUEUE_SOURCE_KINDS.album, id: album.id } as const,
    })),
    ...library.playlists().map((playlist) => ({
      title: playlist.name,
      line: playlistFactsOf({ playlist }),
      target: { kind: BROWSE_KINDS.playlist, playlistId: playlist.id } as const,
      source: { kind: QUEUE_SOURCE_KINDS.playlist, id: playlist.id } as const,
    })),
  ]
  return (
    <FlatList
      ListEmptyComponent={<Notice text={LIBRARY_PAGE_COPY.noDownloads} />}
      ListHeaderComponent={header}
      contentContainerStyle={content}
      data={rows}
      keyExtractor={(row) => browseIdOf(row.target)}
      renderItem={({ item }) => (
        <ListRow
          line={item.line}
          onPress={() => playTracks({ tracks: library.tracksOf(item.target), source: item.source })}
          title={item.title}
        />
      )}
      style={pageStyles.ground}
    />
  )
}
