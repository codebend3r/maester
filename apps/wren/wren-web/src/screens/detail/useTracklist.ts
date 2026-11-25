import type { QueueSource, Track } from '@raven/core'
import { playingIdOf, useAudioQueue } from '@raven/ui/headless'
import { useState } from 'react'
import { useToast } from '@/stores/toast'

type UseTracklistProps = {
  tracks: readonly Track[]
  /** The album or the playlist the queue says it plays from. */
  source: QueueSource
  /** What the toast says once the tracks are queued. */
  queued: string
}

/**
 * What an album's and a playlist's page do with their tracks: play them from the top, shuffled
 * or from a row, queue them with a toast, and open their More sheet. `playingId` marks the row
 * that plays.
 */
export const useTracklist = ({ tracks, source, queued }: UseTracklistProps) => {
  const playingId = useAudioQueue(playingIdOf)
  const playTracks = useAudioQueue((store) => store.playTracks)
  const addToQueue = useAudioQueue((store) => store.addToQueue)
  const toast = useToast((state) => state.show)
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  return {
    playingId,
    play: () => playTracks({ tracks, source }),
    shuffle: () => playTracks({ tracks, source, isShuffled: true }),
    playFrom: (index: number) => playTracks({ tracks, startAt: index, source }),
    queue: () => {
      addToQueue(tracks)
      toast(queued)
    },
    isMenuOpen,
    openMenu: () => setIsMenuOpen(true),
    closeMenu: () => setIsMenuOpen(false),
  }
}
