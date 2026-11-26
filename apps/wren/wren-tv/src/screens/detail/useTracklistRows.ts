import type { AlbumTrack, QueueSource, Track } from '@raven/core'
import { playingIdOf, useAudioQueue } from '@raven/ui/headless'

/** What a row of either page's tracklist is drawn from; a playlist's row has the same fields. */
type TracklistRow = Pick<AlbumTrack, 'id' | 'index' | 'label' | 'length' | 'track'>

type UseTracklistRowsProps = {
  tracks: readonly Track[]
  /** The album or the playlist the queue says it plays from. */
  source: QueueSource
}

/**
 * What every row of an album's or a playlist's tracklist shares, the phone's: its name and length,
 * whether it is the one playing, and the press that plays the page from it.
 */
export const useTracklistRows = ({ tracks, source }: UseTracklistRowsProps) => {
  const playingId = useAudioQueue(playingIdOf)
  const playTracks = useAudioQueue((store) => store.playTracks)
  return ({ id, index, label, length, track }: TracklistRow) => ({
    isCurrent: id === playingId,
    label,
    length,
    onPress: () => playTracks({ tracks, startAt: index, source }),
    track,
  })
}
