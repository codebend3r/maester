import { useState } from 'react'
import type { GestureResponderEvent, ViewProps } from 'react-native'

import { playedShareOf, scrubberAccessibilityOf, within } from '@/layouts/playerKit'

type UseScrubProps = {
  /** Where the video or track is, in seconds. */
  position: number
  /** How long it is, in seconds; 0 while unknown. */
  duration: number
  onSeek: (seconds: number) => void
  /** How far the line stands in from each end, in points, so a thumb at either end shows whole. */
  inset: number
  /** Whether a finger takes the line at all. */
  canDrag: boolean
}

type ScrubLineProps = ReturnType<typeof scrubberAccessibilityOf> &
  Pick<
    ViewProps,
    | 'onLayout'
    | 'onMoveShouldSetResponder'
    | 'onStartShouldSetResponder'
    | 'onResponderGrant'
    | 'onResponderMove'
    | 'onResponderRelease'
    | 'onResponderTerminate'
  >

type Scrub = {
  /** The time the line shows: the finger's spot while it drags, otherwise the position. */
  shown: number
  /** How far along the line `shown` is, as a width or an offset. */
  share: `${number}%`
  /** What the line's view takes: its size, the finger's drag and the screen reader's skips. */
  lineProps: ScrubLineProps
}

/**
 * A line to drag along, as the film player's scrubber and the music's seek bar share it: the
 * finger's spot shows as it moves and is sought on letting go, and VoiceOver reads it as the
 * time of the length and skips by a swipe.
 */
export const useScrub = ({ position, duration, onSeek, inset, canDrag }: UseScrubProps): Scrub => {
  const [width, setWidth] = useState(0)
  const [dragged, setDragged] = useState<number | null>(null)
  const rail = width - inset * 2
  const timeAt = (event: GestureResponderEvent): number =>
    rail <= 0
      ? position
      : within({
          value: ((event.nativeEvent.locationX - inset) / rail) * duration,
          length: duration,
        })
  const shown = dragged ?? position
  return {
    shown,
    share: playedShareOf({ at: shown, duration }),
    lineProps: {
      ...scrubberAccessibilityOf({ position, shown, duration, onSeek }),
      onLayout: ({ nativeEvent }) => setWidth(nativeEvent.layout.width),
      onMoveShouldSetResponder: () => canDrag,
      onStartShouldSetResponder: () => canDrag,
      onResponderGrant: (event) => setDragged(timeAt(event)),
      onResponderMove: (event) => setDragged(timeAt(event)),
      onResponderRelease: (event) => {
        onSeek(timeAt(event))
        setDragged(null)
      },
      onResponderTerminate: () => setDragged(null),
    },
  }
}
