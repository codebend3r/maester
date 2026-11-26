import type { QueueSource, Track } from '@raven/core'
import { useAudioQueue } from '@raven/ui/headless'
import { PLAYER_COPY, WREN_ICONS } from '@raven/wren'
import { toastFailure } from '@raven/wren-native'

import { BUTTON_TONES, FocusButton } from '@/ui/FocusButton'

type PlayButtonsProps = {
  /** The songs they play, read as a press needs them: an artist's are fetched then. */
  tracksOf: () => Promise<readonly Track[]>
  /** Where the queue says it plays from: the album, the playlist or the artist; none for a list. */
  source?: QueueSource
  /** Whether the remote starts on Play as the page opens. */
  hasPreferredFocus?: boolean
}

/**
 * Play and Shuffle side by side, for a page or a list of songs: each fills the queue from the
 * top, Shuffle in a random order, and a read the server refuses is said in the toast.
 */
export function PlayButtons({ tracksOf, source, hasPreferredFocus }: PlayButtonsProps) {
  const playTracks = useAudioQueue((store) => store.playTracks)
  const play = () => {
    tracksOf().then((tracks) => playTracks({ tracks, source }), toastFailure)
  }
  const shuffle = () => {
    tracksOf().then((tracks) => playTracks({ tracks, source, isShuffled: true }), toastFailure)
  }
  return (
    <>
      <FocusButton
        hasPreferredFocus={hasPreferredFocus}
        icon={WREN_ICONS.play}
        label={PLAYER_COPY.play}
        onPress={play}
        text={PLAYER_COPY.play}
        tone={BUTTON_TONES.primary}
      />
      <FocusButton
        icon={WREN_ICONS.shuffle}
        label={PLAYER_COPY.shuffle}
        onPress={shuffle}
        text={PLAYER_COPY.shuffle}
      />
    </>
  )
}
