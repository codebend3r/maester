import { QUEUE_SOURCE_KINDS, type QueueSource, artistNames } from '@raven/core'
import { BROWSE_KINDS, type BrowseTarget, browseIdOf } from '@raven/native/headless'
import { playlistFactsOf, useAudioQueue } from '@raven/ui/headless'
import type { ReactElement } from 'react'
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native'

import { AlbumArt } from '@/components/AlbumTile'
import { Notice } from '@/components/Notice'
import { pageStyles, useListContent } from '@/components/TabPage'
import { downloadedLibraryOf, useDownloads } from '@/downloads/downloadStore'
import { deviceDisk } from '@/downloads/downloader'
import { LIBRARY_PAGE_COPY } from '@/screens/copy'
import { OPACITIES, PALETTE, SIZES } from '@/theme/wrenTheme'

/** One downloaded album or playlist as its row shows it, and what it plays. */
type DownloadedRow = {
  title: string
  line: string
  target: BrowseTarget
  source: QueueSource
}

type DownloadRowProps = { row: DownloadedRow; artworkUri: string | null; onPress: () => void }

/** A downloaded album or playlist: the cover saved with it, its name and what it holds. */
function DownloadRow({ row, artworkUri, onPress }: DownloadRowProps) {
  return (
    <Pressable
      accessibilityLabel={row.title}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <AlbumArt
        cover={artworkUri === null ? null : { uri: artworkUri, headers: {} }}
        size={SIZES.fieldHeight}
      />
      <View style={styles.text}>
        <Text numberOfLines={1} style={styles.title}>
          {row.title}
        </Text>
        <Text numberOfLines={1} style={styles.line}>
          {row.line}
        </Text>
      </View>
    </Pressable>
  )
}

type DownloadsListProps = { serverId: string; header: ReactElement }

/**
 * Library's Downloads: the albums, then the playlists, downloaded from this server, read from
 * the device alone, so the list plays with the server out of reach. A row wears the cover saved
 * with it and plays its tracks from their files.
 */
export function DownloadsList({ serverId, header }: DownloadsListProps) {
  const content = useListContent()
  const entries = useDownloads((state) => state.entries)
  const playlists = useDownloads((state) => state.playlists)
  const playTracks = useAudioQueue((store) => store.playTracks)
  const library = downloadedLibraryOf({ entries, playlists, serverId, uriOf: deviceDisk.uriOf })
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
        <DownloadRow
          artworkUri={library.artworkOf(item.target)}
          onPress={() => playTracks({ tracks: library.tracksOf(item.target), source: item.source })}
          row={item}
        />
      )}
      style={pageStyles.ground}
    />
  )
}

const styles = StyleSheet.create({
  row: {
    alignItems: 'center',
    borderBottomColor: PALETTE.line,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: SIZES.space3,
    paddingVertical: SIZES.space2,
  },
  text: { flex: 1, gap: SIZES.space1 },
  title: { color: PALETTE.text, fontSize: SIZES.text, fontWeight: 'bold' },
  line: { color: PALETTE.muted, fontSize: SIZES.textSm },
  pressed: { opacity: OPACITIES.pressed },
})
