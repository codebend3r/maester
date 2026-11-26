import { formatBytes } from '@raven/core'
import { queueSourceOf } from '@raven/native/headless'
import { useAudioQueue } from '@raven/ui/headless'
import { useRouter } from 'expo-router'
import { FlatList, Pressable, Text, View } from 'react-native'

import { LIBRARY_PAGE_COPY } from '@raven/wren'
import { PlayButtons } from '@/components/PlayButtons'
import { useDownloads } from '@/downloads/downloadStore'
import { deviceDisk } from '@/downloads/downloader'
import { useStorageMeter } from '@/downloads/storageMeter'
import { CollectionHeader } from '@/screens/library/CollectionHeader'
import { type DownloadedRow, allTracksOf, downloadRowsOf } from '@/screens/library/downloadRows'
import { WREN_ROUTES } from '@raven/wren-native/headless'
import { usePageInsets } from '@/shell/useShell'
import { useWrenPrefs } from '@/stores/wrenPrefs'
import { type WrenTheme, themedStyles } from '@/theme/wrenTheme'
import { RADIUS, SIZE, SPACE, TYPE } from '@/theme/wrenTokens'
import { AlbumArt } from '@/ui/AlbumArt'
import { Card } from '@/ui/Card'
import { EmptyState } from '@/ui/EmptyState'
import { MeterBar } from '@/ui/MeterBar'
import { pressedStyleOf } from '@/ui/press'
import { TextLink } from '@/ui/TextLink'
import { ICONS } from '@/ui/WrenIcon'

const useStyles = themedStyles(({ colors }: WrenTheme) => ({
  ground: { backgroundColor: colors.bg, flex: 1 },
  header: { paddingBottom: SPACE.s2 },
  card: { gap: SPACE.s3, padding: SPACE.s4 },
  cardRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: SPACE.s3,
    justifyContent: 'space-between',
  },
  cardTitle: { ...TYPE.rowStrong, color: colors.text },
  cardValue: { ...TYPE.meta, color: colors.text2 },
  actions: { flexDirection: 'row', gap: SPACE.s3 },
  row: {
    alignItems: 'center',
    borderBottomColor: colors.line,
    borderBottomWidth: SIZE.hairline,
    flexDirection: 'row',
    gap: SIZE.rowGap,
    minHeight: SIZE.row,
    paddingVertical: SPACE.s2,
  },
  text: { flex: 1 },
  title: { ...TYPE.rowTitle, color: colors.text },
  line: { ...TYPE.meta, color: colors.text2 },
  size: { ...TYPE.time, color: colors.text3 },
}))

/** What the downloads take of the limit, their quality, and the way to Settings to change them. */
function StorageCard() {
  const styles = useStyles()
  const router = useRouter()
  const kbps = useWrenPrefs((state) => state.downloadKbps)
  const { value, fraction } = useStorageMeter()
  return (
    <Card style={styles.card}>
      <View style={styles.cardRow}>
        <Text style={styles.cardTitle}>{LIBRARY_PAGE_COPY.onThisDevice}</Text>
        <Text style={styles.cardValue}>{value}</Text>
      </View>
      {fraction !== null && <MeterBar fraction={fraction} />}
      <View style={styles.cardRow}>
        <Text style={styles.cardValue}>{LIBRARY_PAGE_COPY.quality(kbps)}</Text>
        <TextLink
          label={LIBRARY_PAGE_COPY.manage}
          onPress={() => router.navigate(WREN_ROUTES.settings)}
          isLink
          spoken={LIBRARY_PAGE_COPY.manageLabel}
        />
      </View>
    </Card>
  )
}

type DownloadRowProps = { row: DownloadedRow; onPress: () => void }

/** A downloaded album or playlist: the cover saved with it, its name, what it holds and takes. */
function DownloadRow({ row, onPress }: DownloadRowProps) {
  const styles = useStyles()
  return (
    <Pressable
      accessibilityLabel={row.title}
      accessibilityRole="button"
      onPress={onPress}
      style={pressedStyleOf({ style: styles.row })}
    >
      <AlbumArt
        cover={row.artworkUri === null ? null : { uri: row.artworkUri, headers: {} }}
        radius={RADIUS.thumb}
        size={SIZE.buttonLarge}
      />
      <View style={styles.text}>
        <Text numberOfLines={1} style={styles.title}>
          {row.title}
        </Text>
        <Text numberOfLines={1} style={styles.line}>
          {row.line}
        </Text>
      </View>
      <Text style={styles.size}>{formatBytes(row.bytes)}</Text>
    </Pressable>
  )
}

function NothingDownloaded() {
  return (
    <EmptyState
      body={LIBRARY_PAGE_COPY.noDownloadsHint}
      icon={ICONS.downloads}
      title={LIBRARY_PAGE_COPY.noDownloads}
    />
  )
}

type DownloadsListProps = { serverId: string; onBack: () => void }

/**
 * Library's Downloads: what the downloads take, then the albums and the playlists downloaded
 * from this server, read from the device alone, so the list plays with the server out of reach.
 * A row wears the cover saved with it and plays its tracks from their files.
 */
export function DownloadsList({ serverId, onBack }: DownloadsListProps) {
  const styles = useStyles()
  const insets = usePageInsets()
  const entries = useDownloads((state) => state.entries)
  const playlists = useDownloads((state) => state.playlists)
  const playTracks = useAudioQueue((store) => store.playTracks)
  const rows = downloadRowsOf({ entries, playlists, serverId, uriOf: deviceDisk.uriOf })
  const tracks = allTracksOf(rows)
  return (
    <FlatList
      ListEmptyComponent={<NothingDownloaded />}
      ListHeaderComponent={
        <CollectionHeader count={null} onBack={onBack} title={LIBRARY_PAGE_COPY.downloads}>
          {rows.length > 0 && <StorageCard />}
          {rows.length > 0 && (
            <View style={styles.actions}>
              <PlayButtons
                onPlay={() => playTracks({ tracks })}
                onShuffle={() => playTracks({ tracks, isShuffled: true })}
              />
            </View>
          )}
        </CollectionHeader>
      }
      ListHeaderComponentStyle={styles.header}
      contentContainerStyle={insets}
      data={rows}
      keyExtractor={(row) => row.key}
      renderItem={({ item }) => (
        <DownloadRow
          onPress={() => playTracks({ tracks: item.tracks, source: queueSourceOf(item.target) })}
          row={item}
        />
      )}
      style={styles.ground}
    />
  )
}
