import { type Track, artistNames, formatDuration } from '@raven/core'
import { playingIdOf, useAudioQueue } from '@raven/ui/headless'
import { SONG_LEADS } from '@raven/wren'

import { TrackRow } from '@/components/TrackRow'
import { type Cover } from '@raven/wren-native'

type SongTrackRowProps = {
  track: Track
  /** Null while the track has no cover. */
  cover: Cover | null
  onPress: () => void
}

/**
 * A song in a list of songs outside its album: its cover, title, artists and length, marked
 * while it is the one playing. Each row reads that for itself, so only the rows it changes draw
 * again.
 */
export function SongTrackRow({ track, cover, onPress }: SongTrackRowProps) {
  const isCurrent = useAudioQueue((store) => playingIdOf(store) === track.id)
  return (
    <TrackRow
      isCurrent={isCurrent}
      label={track.title}
      lead={{ kind: SONG_LEADS.art, cover }}
      length={formatDuration(track.duration)}
      onPress={onPress}
      subtitle={artistNames(track)}
      track={track}
    />
  )
}
