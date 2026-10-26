import { type RefObject, useReducer, useRef } from 'react'
import { useVideoEvents } from '@/components/Player/useVideoEvents'
import {
  type Ranges,
  VIDEO_EVENTS,
  initialVideoState,
  videoReducer,
} from '@/components/Player/videoState'

type ClampProps = { value: number; min: number; max: number }

const clamp = ({ value, min, max }: ClampProps): number => Math.min(max, Math.max(min, value))

type BufferedRangesProps = { element: HTMLVideoElement; shift: number }

/** A <video>'s buffered ranges on the file's clock. */
const bufferedRanges = ({ element, shift }: BufferedRangesProps): Ranges =>
  Array.from({ length: element.buffered.length }, (_, index): [number, number] => [
    Math.max(0, element.buffered.start(index) - shift),
    Math.max(0, element.buffered.end(index) - shift),
  ])

type UseVideoStateProps = {
  videoRef: RefObject<HTMLVideoElement | null>
  shift: number
  startAt: number
  /** The file's length as the probe found it, which wins over the element's. */
  knownDuration: number | null
}

/**
 * The element's state as the stage draws it, kept in step with its events.
 * `position` is where playback is, kept across a change of source so the
 * new one picks up there; `playing` whether to keep playing across one.
 * A converted stream runs `shift` seconds ahead of the file.
 */
export const useVideoState = ({ videoRef, shift, startAt, knownDuration }: UseVideoStateProps) => {
  const [state, dispatch] = useReducer(videoReducer, startAt, initialVideoState)
  const position = useRef(startAt)
  // The first source autoplays.
  const playing = useRef(true)
  const duration = knownDuration ?? state.elementDuration

  const fileTime = (): number => Math.max(0, (videoRef.current?.currentTime ?? 0) - shift)

  const moved = (element: HTMLVideoElement) => {
    // Before metadata the clock reads zero whatever the source will start at.
    if (element.readyState < HTMLMediaElement.HAVE_METADATA) return
    position.current = fileTime()
    dispatch({
      type: VIDEO_EVENTS.moved,
      time: position.current,
      buffered: bufferedRanges({ element, shift }),
    })
  }

  useVideoEvents({
    videoRef,
    on: {
      timeupdate: moved,
      seeked: moved,
      progress: (element) =>
        dispatch({ type: VIDEO_EVENTS.buffered, buffered: bufferedRanges({ element, shift }) }),
      durationchange: (element) => {
        const total = element.duration - shift
        dispatch({
          type: VIDEO_EVENTS.duration,
          duration: Number.isFinite(total) && total > 0 ? total : null,
        })
      },
      play: () => {
        // Play is intent; only playing confirms frames for progress and history.
        playing.current = true
        dispatch({ type: VIDEO_EVENTS.played })
        dispatch({ type: VIDEO_EVENTS.waiting })
      },
      playing: () => {
        playing.current = true
        dispatch({ type: VIDEO_EVENTS.played })
        dispatch({ type: VIDEO_EVENTS.flowing })
      },
      ended: () => {
        position.current = fileTime()
        dispatch({ type: VIDEO_EVENTS.ended })
      },
      waiting: () => dispatch({ type: VIDEO_EVENTS.waiting }),
      // A first frame held paused, as when autoplay is refused; playing ends a wait otherwise.
      canplay: (element) => {
        if (element.paused) dispatch({ type: VIDEO_EVENTS.flowing })
      },
      pause: (element) => {
        // Letting go of a source on the way to another pauses too; that is not the viewer.
        if (element.readyState === HTMLMediaElement.HAVE_NOTHING) return
        position.current = fileTime()
        playing.current = false
        dispatch({ type: VIDEO_EVENTS.paused })
      },
      ratechange: (element) => dispatch({ type: VIDEO_EVENTS.rate, rate: element.playbackRate }),
    },
  })

  /** Moves playback to `target` seconds of the file, kept short of the very end. */
  const seek = (target: number) => {
    const element = videoRef.current
    if (!element) return
    const to = clamp({ value: target, min: 0, max: Math.max(0, (duration ?? Infinity) - 0.5) })
    element.currentTime = to + shift
    position.current = to
    dispatch({ type: VIDEO_EVENTS.sought, time: to })
  }

  return {
    state,
    duration,
    position,
    playing,
    fileTime,
    seek,
    /** The browser refused to start playing. */
    refused: () => dispatch({ type: VIDEO_EVENTS.paused }),
  }
}
