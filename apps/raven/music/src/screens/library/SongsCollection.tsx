import { artistNames, formatDuration, plural } from '@raven/core'
import { playingIdOf, useAudioQueue } from '@raven/ui/headless'
import { COUNTS_COPY, LIBRARY_PAGE_COPY, LIST_SORTS, type ListSort, SONG_LEADS } from '@raven/wren'
import { useState } from 'react'
import { FlatList, View } from 'react-native'

import { PlayButtons } from '@/components/PlayButtons'
import { TrackRow } from '@/components/TrackRow'
import { useCovers } from '@/music/useCovers'
import { CollectionHeader } from '@/screens/library/CollectionHeader'
import type { CollectionPageProps } from '@/screens/library/CollectionPage'
import { useAllSongs, useSongCount } from '@/screens/library/listings'
import { ListNotice } from '@/screens/library/ListNotice'
import { useCollectionSearch } from '@/screens/library/useCollectionSearch'
import { usePageInsets } from '@/shell/useShell'
import { type WrenTheme, themedStyles } from '@/theme/wrenTheme'
import { SPACE } from '@/theme/wrenTokens'

const useStyles = themedStyles(({ colors }: WrenTheme) => ({
  ground: { backgroundColor: colors.bg, flex: 1 },
  header: { paddingBottom: SPACE.s1 },
  actions: { flexDirection: 'row', gap: SPACE.s3 },
}))

/**
 * Songs: every music library's tracks a page at a time, in the order picked and found by what
 * is typed, both by the server. Play and Shuffle play what has been read so far.
 */
export function SongsCollection({ session, onBack }: CollectionPageProps) {
  const styles = useStyles()
  const insets = usePageInsets()
  const { trackCoverOf } = useCovers(session)
  const search = useCollectionSearch({
    placeholder: LIBRARY_PAGE_COPY.searchSongs,
    none: LIBRARY_PAGE_COPY.noSongs,
  })
  const [sort, setSort] = useState<ListSort>(LIST_SORTS.title)
  const n = useSongCount({ session, search: search.query })
  const playTracks = useAudioQueue((store) => store.playTracks)
  const playingId = useAudioQueue(playingIdOf)
  const { tracks, listing, nextPage } = useAllSongs({ session, search: search.query, sort })
  const header = (
    <CollectionHeader
      count={n === null ? null : plural({ n, ...COUNTS_COPY.songs })}
      onBack={onBack}
      search={search.field}
      sort={{ sort, onSort: setSort }}
      title={LIBRARY_PAGE_COPY.songs}
    >
      {tracks.length > 0 && (
        <View style={styles.actions}>
          <PlayButtons
            onPlay={() => playTracks({ tracks })}
            onShuffle={() => playTracks({ tracks, isShuffled: true })}
          />
        </View>
      )}
    </CollectionHeader>
  )
  return (
    <FlatList
      ListEmptyComponent={<ListNotice empty={search.empty} listing={listing} />}
      ListHeaderComponent={header}
      ListHeaderComponentStyle={styles.header}
      contentContainerStyle={insets}
      data={tracks}
      keyExtractor={(track, index) => `${track.id}:${index}`}
      keyboardDismissMode="on-drag"
      onEndReached={nextPage}
      renderItem={({ item, index }) => (
        <TrackRow
          isCurrent={item.id === playingId}
          label={item.title}
          lead={{ kind: SONG_LEADS.art, cover: trackCoverOf(item) }}
          length={formatDuration(item.duration)}
          onPress={() => playTracks({ tracks, startAt: index })}
          subtitle={artistNames(item)}
          track={item}
        />
      )}
      style={styles.ground}
      testID="songs"
    />
  )
}
