import type { AlbumTrack, QueueSource, Track } from '@raven/core'
import { playingIdOf, useAudioQueue } from '@raven/ui/headless'
import { useState } from 'react'

type UseTracklistProps = {
  /** The page's tracks, read when an action needs them: an artist's are fetched then. */
  tracksOf: () => Promise<readonly Track[]>
}

/**
 * What an album's, a playlist's and an artist's page do with their tracks, the phone's: hand them
 * to Play, Shuffle and the More menu through `tracksOf`, and open and close that menu.
 */
export const useTracklist = ({ tracksOf }: UseTracklistProps) => {
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  return {
    tracksOf,
    isMenuOpen,
    openMenu: () => setIsMenuOpen(true),
    closeMenu: () => setIsMenuOpen(false),
  }
}

/** What a row of either page's tracklist is drawn from; a playlist's row has the same fields. */
type TracklistRow = Pick<AlbumTrack, 'id' | 'index' | 'label' | 'length' | 'track'>

type UseTracklistRowsProps = {
  tracks: readonly Track[]
  /** The album or the playlist the queue says it plays from. */
  source: QueueSource
}

/**
 * What every row of an album's or a playlist's tracklist shares: its name and length, whether it
 * is the one playing, and the press that plays the page from it.
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
