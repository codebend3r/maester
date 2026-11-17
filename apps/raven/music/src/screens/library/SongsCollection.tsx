import { type Track, artistNames, formatDuration, plural } from '@raven/core'
import { playingTrackOf, useAudioQueue, useSearch } from '@raven/ui/headless'
import { useInfiniteQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { FlatList, View } from 'react-native'

import { PlayButtons } from '@/components/PlayButtons'
import { TrackRow } from '@/components/TrackRow'
import { listStateOf } from '@/music/merged'
import { useMusicLibraries } from '@/music/musicLibraries'
import { nextPageOf } from '@/music/nextPage'
import { useCovers } from '@/music/useCovers'
import { LIBRARY_PAGE_COPY } from '@/screens/copy'
import { CollectionHeader } from '@/screens/library/CollectionHeader'
import type { CollectionPageProps } from '@/screens/library/CollectionPage'
import { useSongCount } from '@/screens/library/listings'
import { ListNotice } from '@/screens/library/ListNotice'
import { LIST_SORTS, type ListSort, SERVER_SORTS } from '@/screens/library/sorts'
import { usePageInsets } from '@/shell/useShell'
import { type WrenTheme, themedStyles } from '@/theme/wrenTheme'
import { SPACE } from '@/theme/wrenTokens'
import { SONG_LEADS } from '@/ui/songLead'
import { COUNTS_COPY } from '@/ui/copy'

const useStyles = themedStyles(({ colors }: WrenTheme) => ({
  ground: { backgroundColor: colors.bg, flex: 1 },
  header: { paddingBottom: SPACE.s1 },
  actions: { flexDirection: 'row', gap: SPACE.s3 },
}))

const NO_TRACKS: readonly Track[] = []

/**
 * Songs: every music library's tracks a page at a time, in the order picked and found by what
 * is typed, both by the server. Play and Shuffle play what has been read so far.
 */
export function SongsCollection({ session, onBack }: CollectionPageProps) {
  const styles = useStyles()
  const insets = usePageInsets()
  const { trackCoverOf } = useCovers(session)
  const search = useSearch()
  const [sort, setSort] = useState<ListSort>(LIST_SORTS.title)
  const music = useMusicLibraries(session)
  const n = useSongCount({ session, search: search.query })
  const playTracks = useAudioQueue((store) => store.playTracks)
  const playingId = useAudioQueue((store) => playingTrackOf(store)?.id ?? null)
  const songs = useInfiniteQuery(
    session.queries.songsQuery({
      libraryIds: music.libraries.map(({ id }) => id),
      search: search.query,
      sort: SERVER_SORTS[sort],
    }),
  )
  const tracks = songs.data?.pages.flatMap((page) => page.tracks) ?? NO_TRACKS
  const header = (
    <CollectionHeader
      count={n === null ? null : plural({ n, ...COUNTS_COPY.songs })}
      onBack={onBack}
      search={{
        value: search.text,
        onChangeText: search.setText,
        placeholder: LIBRARY_PAGE_COPY.searchSongs,
      }}
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
      ListEmptyComponent={
        <ListNotice
          empty={search.query === '' ? LIBRARY_PAGE_COPY.noSongs : LIBRARY_PAGE_COPY.noMatches}
          listing={listStateOf({ music, failure: songs.error, isRead: songs.isSuccess })}
        />
      }
      ListHeaderComponent={header}
      ListHeaderComponentStyle={styles.header}
      contentContainerStyle={insets}
      data={tracks}
      keyExtractor={(track, index) => `${track.id}:${index}`}
      keyboardDismissMode="on-drag"
      onEndReached={nextPageOf(songs)}
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
