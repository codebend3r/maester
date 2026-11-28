import type { QueueSource, Track } from '@raven/core'
import { isPlayingOf, useAudioQueue } from '@raven/ui/headless'
import {
  PAGE_PLAYS,
  PLAYER_COPY,
  type PagePlay,
  WREN_ICONS,
  type WrenIconName,
  pagePlayOf,
} from '@raven/wren'
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

type PagePlayLook = { icon: WrenIconName; text: string }

/** How Play reads for what a press does: Pause while the page plays, Play otherwise. */
const PAGE_PLAY_LOOKS = {
  [PAGE_PLAYS.start]: { icon: WREN_ICONS.play, text: PLAYER_COPY.play },
  [PAGE_PLAYS.resume]: { icon: WREN_ICONS.play, text: PLAYER_COPY.play },
  [PAGE_PLAYS.pause]: { icon: WREN_ICONS.pause, text: PLAYER_COPY.pause },
} as const satisfies Record<PagePlay, PagePlayLook>

/**
 * Play and Shuffle side by side, for a page or a list of songs: Play fills the queue from the top,
 * or, while the queue plays from this page, pauses it and carries on again; Shuffle always fills
 * it in a random order. A read the server refuses is said in the toast.
 */
export function PlayButtons({ tracksOf, source, hasPreferredFocus }: PlayButtonsProps) {
  const playTracks = useAudioQueue((store) => store.playTracks)
  const pause = useAudioQueue((store) => store.pause)
  const resume = useAudioQueue((store) => store.play)
  const queued = useAudioQueue((store) => store.queue.source)
  const isPlaying = useAudioQueue(isPlayingOf)
  const pagePlay = pagePlayOf({ source, queued, isPlaying })
  const start = () => {
    tracksOf().then((tracks) => playTracks({ tracks, source }), toastFailure)
  }
  const shuffle = () => {
    tracksOf().then((tracks) => playTracks({ tracks, source, isShuffled: true }), toastFailure)
  }
  const presses = {
    [PAGE_PLAYS.start]: start,
    [PAGE_PLAYS.pause]: pause,
    [PAGE_PLAYS.resume]: resume,
  } as const satisfies Record<PagePlay, () => void>
  const look = PAGE_PLAY_LOOKS[pagePlay]
  return (
    <>
      <FocusButton
        hasPreferredFocus={hasPreferredFocus}
        icon={look.icon}
        label={look.text}
        onPress={presses[pagePlay]}
        text={look.text}
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
