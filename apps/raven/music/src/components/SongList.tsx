import { type Track, artistNames, formatDuration } from '@raven/core'
import { playingTrackOf, useAudioQueue } from '@raven/ui/headless'
import type { ReactElement } from 'react'
import { FlatList } from 'react-native'

import { pageStyles, useListContent } from '@/components/TabPage'
import { TrackRow } from '@/components/TrackRow'

type SongRowProps = { tracks: readonly Track[]; track: Track; index: number; isPlaying: boolean }

/** A song in a list of many: its title and artists, a press playing the list from it. */
export function SongRow({ tracks, track, index, isPlaying }: SongRowProps) {
  const playTracks = useAudioQueue((store) => store.playTracks)
  return (
    <TrackRow
      isPlaying={isPlaying}
      label={track.title}
      lead={null}
      length={formatDuration(track.duration)}
      line={artistNames(track)}
      onPress={() => playTracks({ tracks, startAt: index })}
      track={track}
    />
  )
}

type SongListProps = {
  tracks: readonly Track[]
  header: ReactElement
  empty: ReactElement
  /** Asks for the next page, as the list nears its end. */
  onEnd: () => void
}

/** Songs a page at a time under a page's header, the next page asked for near the end. */
export function SongList({ tracks, header, empty, onEnd }: SongListProps) {
  const listContent = useListContent()
  const playingId = useAudioQueue((store) => playingTrackOf(store)?.id ?? null)
  return (
    <FlatList
      ListEmptyComponent={empty}
      ListHeaderComponent={header}
      contentContainerStyle={listContent}
      data={tracks}
      keyExtractor={(track, index) => `${track.id}:${index}`}
      onEndReached={onEnd}
      renderItem={({ item, index }) => (
        <SongRow index={index} isPlaying={item.id === playingId} track={item} tracks={tracks} />
      )}
      style={pageStyles.ground}
      testID="songs"
    />
  )
}
