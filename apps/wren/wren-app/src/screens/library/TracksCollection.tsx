import { type Track, plural } from '@raven/core'
import { useAudioQueue } from '@raven/ui/headless'
import { COUNTS_COPY, LIBRARY_PAGE_COPY, type ListState } from '@raven/wren'
import { FlatList, View } from 'react-native'

import { PlayButtons } from '@/components/PlayButtons'
import { SongTrackRow } from '@/components/SongTrackRow'
import { useCovers, useFinishedTracks, useInProgressTracks } from '@raven/wren-native'
import { CollectionHeader } from '@/screens/library/CollectionHeader'
import type { CollectionPageProps } from '@/screens/library/CollectionPage'
import { LIST_SHAPES } from '@/components/ListSkeleton'
import { ListNotice } from '@/screens/library/ListNotice'
import { usePageInsets } from '@/shell/useShell'
import { type WrenTheme, themedStyles } from '@/theme/wrenTheme'
import { SPACE } from '@/theme/wrenTokens'

const useStyles = themedStyles(({ colors }: WrenTheme) => ({
  ground: { backgroundColor: colors.bg, flex: 1 },
  header: { paddingBottom: SPACE.s1 },
  actions: { flexDirection: 'row', gap: SPACE.s3 },
}))

type TracksPageProps = CollectionPageProps & {
  title: string
  /** What the page says when it lists none. */
  empty: string
  tracks: readonly Track[]
  listing: ListState
}

/** A category of songs: its title and count, Play and Shuffle, then a row for each song, which plays the list from there. */
function TracksPage({ session, onBack, title, empty, tracks, listing }: TracksPageProps) {
  const styles = useStyles()
  const insets = usePageInsets()
  const { trackCoverOf } = useCovers(session)
  const playTracks = useAudioQueue((store) => store.playTracks)
  const isCounted = listing.isRead && tracks.length > 0
  return (
    <FlatList
      ListEmptyComponent={<ListNotice empty={empty} listing={listing} shape={LIST_SHAPES.rows} />}
      ListHeaderComponent={
        <CollectionHeader
          count={isCounted ? plural({ n: tracks.length, ...COUNTS_COPY.songs }) : null}
          onBack={onBack}
          title={title}
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
      }
      ListHeaderComponentStyle={styles.header}
      contentContainerStyle={insets}
      data={tracks}
      keyExtractor={(track) => String(track.id)}
      renderItem={({ item, index }) => (
        <SongTrackRow
          cover={trackCoverOf(item)}
          onPress={() => playTracks({ tracks, startAt: index })}
          track={item}
        />
      )}
      style={styles.ground}
    />
  )
}

/** In progress: the songs this device left partway through, in the music library worn. */
export function InProgressCollection({ session, onBack }: CollectionPageProps) {
  const { tracks, listing } = useInProgressTracks(session)
  return (
    <TracksPage
      empty={LIBRARY_PAGE_COPY.noInProgress}
      listing={listing}
      onBack={onBack}
      session={session}
      title={LIBRARY_PAGE_COPY.inProgress}
      tracks={tracks}
    />
  )
}

/** Recently finished: the songs this device played to their end most recently, in the music library worn. */
export function FinishedCollection({ session, onBack }: CollectionPageProps) {
  const { tracks, listing } = useFinishedTracks(session)
  return (
    <TracksPage
      empty={LIBRARY_PAGE_COPY.noFinished}
      listing={listing}
      onBack={onBack}
      session={session}
      title={LIBRARY_PAGE_COPY.finished}
      tracks={tracks}
    />
  )
}
