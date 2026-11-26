import type { AlbumTrack, QueueSource, Track } from '@raven/core'
import { playingIdOf, useAudioQueue } from '@raven/ui/headless'
import { useState } from 'react'

import { useToast } from '@raven/wren-native'
import { useFormFactor } from '@/theme/wrenTheme'
import { FORM_FACTORS, type FormFactor } from '@/theme/wrenTokens'

/** A tablet's tracklist marks the playing row with a soft fill as well as the equalizer. */
const IS_ROW_HIGHLIGHTED = {
  [FORM_FACTORS.phone]: false,
  [FORM_FACTORS.tablet]: true,
} as const satisfies Record<FormFactor, boolean>

type UseTracklistProps = {
  tracks: readonly Track[]
  /** The album or the playlist the queue says it plays from. */
  source: QueueSource
  /** What the toast says once the tracks are queued. */
  queued: string
}

/** What a row of either page's tracklist is drawn from; a playlist's row has the same fields. */
type TracklistRow = Pick<AlbumTrack, 'id' | 'index' | 'label' | 'length' | 'track'>

/**
 * What an album's and a playlist's page do with their tracks: play them from the top or shuffled,
 * queue them with a toast, and open their More sheet, which reads them through `tracksOf`.
 * `rowPropsOf` is what every row of the tracklist shares: its name and length, whether it is the
 * one playing, and the press that plays from it.
 */
export const useTracklist = ({ tracks, source, queued }: UseTracklistProps) => {
  const playingId = useAudioQueue(playingIdOf)
  const playTracks = useAudioQueue((store) => store.playTracks)
  const addToQueue = useAudioQueue((store) => store.addToQueue)
  const toast = useToast((state) => state.show)
  const formFactor = useFormFactor()
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  return {
    rowPropsOf: ({ id, index, label, length, track }: TracklistRow) => ({
      isCurrent: id === playingId,
      isHighlighted: IS_ROW_HIGHLIGHTED[formFactor],
      label,
      length,
      onPress: () => playTracks({ tracks, startAt: index, source }),
      track,
    }),
    tracksOf: async () => tracks,
    play: () => playTracks({ tracks, source }),
    shuffle: () => playTracks({ tracks, source, isShuffled: true }),
    queue: () => {
      addToQueue(tracks)
      toast(queued)
    },
    isMenuOpen,
    openMenu: () => setIsMenuOpen(true),
    closeMenu: () => setIsMenuOpen(false),
  }
}
