import type { Track } from '@raven/core'
import { useAudioQueue } from '@raven/ui/headless'
import type { ListState } from '@raven/wren'
import type { ReactNode } from 'react'
import { FlatList } from 'react-native'

import { ListNotice } from '@/components/ListNotice'
import { ListFrame } from '@/ui/ListFrame'
import { usePageStyles } from '@/ui/pageStyles'
import { SPACE } from '@/theme/tvTokens'
import { themedStyles } from '@/theme/wrenTheme'
import { useCovers } from '@raven/wren-native'
import type { CollectionPageProps } from '@/screens/library/CollectionPage'
import { SongTrackRow } from '@/components/SongTrackRow'

type TracksPageProps = CollectionPageProps & {
  /** What stands over the songs: the page's header. */
  header: ReactNode
  /** What the page says when it lists none; null where its header says it instead. */
  empty: string | null
  tracks: readonly Track[]
  listing: ListState
  /** Asks for the next page as the list nears its end; none for a list read whole. */
  onEndReached?: () => void
}

const useStyles = themedStyles(() => ({ content: { gap: SPACE.s4, padding: SPACE.gutter } }))

/** A page of songs under its header, each row playing the list from there. */
export function TracksPage({
  session,
  header,
  empty,
  tracks,
  listing,
  onEndReached,
}: TracksPageProps) {
  const styles = useStyles()
  const page = usePageStyles()
  const { trackCoverOf } = useCovers(session)
  const playTracks = useAudioQueue((store) => store.playTracks)
  return (
    <ListFrame style={page.ground}>
      {(fill) => (
        <FlatList
          ListEmptyComponent={
            <>{empty !== null && <ListNotice empty={empty} listing={listing} />}</>
          }
          ListHeaderComponent={<>{header}</>}
          contentContainerStyle={styles.content}
          data={tracks}
          keyExtractor={(track, index) => `${track.id}:${index}`}
          onEndReached={onEndReached}
          renderItem={({ item, index }) => (
            <SongTrackRow
              cover={trackCoverOf(item)}
              onPress={() => playTracks({ tracks, startAt: index })}
              track={item}
            />
          )}
          style={fill}
        />
      )}
    </ListFrame>
  )
}
