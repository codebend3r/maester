import { type RefObject, useReducer, useRef } from 'react'
import { useVideoEvents } from '@/components/Player/useVideoEvents'

type Ranges = ReadonlyArray<[number, number]>

/** What the stage draws of the element: where it is, what is loaded, whether it plays. All times are file time. */
export type VideoState = {
  time: number
  /** The element's own idea of the length, for a file the probe could not time. */
  elementDuration: number | null
  buffered: Ranges
  paused: boolean
  waiting: boolean
  rate: number
}

export type VideoEvent =
  | { type: 'moved'; time: number; buffered: Ranges }
  | { type: 'sought'; time: number }
  | { type: 'buffered'; buffered: Ranges }
  | { type: 'duration'; duration: number | null }
  | { type: 'played' }
  | { type: 'paused' }
  | { type: 'waiting' }
  | { type: 'flowing' }
  | { type: 'rate'; rate: number }

export const initialVideoState = (startAt: number): VideoState => ({
  time: startAt,
  elementDuration: null,
  buffered: [],
  paused: true,
  waiting: false,
  rate: 1,
})

export const videoReducer = (state: VideoState, event: VideoEvent): VideoState => {
  switch (event.type) {
    case 'moved':
      return { ...state, time: event.time, buffered: event.buffered }
    case 'sought':
      return { ...state, time: event.time }
    case 'buffered':
      return { ...state, buffered: event.buffered }
    case 'duration':
      return { ...state, elementDuration: event.duration }
    case 'played':
      return { ...state, paused: false }
    case 'paused':
      return { ...state, paused: true }
    case 'waiting':
      return { ...state, waiting: true }
    case 'flowing':
      return { ...state, waiting: false }
    case 'rate':
      return { ...state, rate: event.rate }
    default: {
      const unknown: never = event
      return unknown
    }
  }
}

const clamp = ({ value, min, max }: { value: number; min: number; max: number }): number =>
  Math.min(max, Math.max(min, value))

/** A <video>'s buffered ranges on the file's clock. */
const bufferedRanges = ({ element, shift }: { element: HTMLVideoElement; shift: number }): Ranges =>
  Array.from({ length: element.buffered.length }, (_, index): [number, number] => [
    Math.max(0, element.buffered.start(index) - shift),
    Math.max(0, element.buffered.end(index) - shift),
  ])

/**
 * The element's state as the stage draws it, kept in step with its events.
 * `position` is where playback is, kept across a change of source so the
 * new one picks up there; `playing` whether to keep playing across one.
 * A converted stream runs `shift` seconds ahead of the file.
 */
export const useVideoState = ({
  videoRef,
  shift,
  startAt,
  knownDuration,
}: {
  videoRef: RefObject<HTMLVideoElement | null>
  shift: number
  startAt: number
  /** The file's length as the probe found it, which wins over the element's. */
  knownDuration: number | null
}) => {
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
      type: 'moved',
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
        dispatch({ type: 'buffered', buffered: bufferedRanges({ element, shift }) }),
      durationchange: (element) => {
        const total = element.duration - shift
        dispatch({ type: 'duration', duration: Number.isFinite(total) && total > 0 ? total : null })
      },
      play: () => {
        playing.current = true
        dispatch({ type: 'played' })
      },
      playing: () => dispatch({ type: 'flowing' }),
      canplay: () => dispatch({ type: 'flowing' }),
      waiting: () => dispatch({ type: 'waiting' }),
      pause: (element) => {
        // Letting go of a source on the way to another pauses too; that is not the viewer.
        if (element.readyState === HTMLMediaElement.HAVE_NOTHING) return
        playing.current = false
        dispatch({ type: 'paused' })
      },
      ratechange: (element) => dispatch({ type: 'rate', rate: element.playbackRate }),
    },
  })

  /** Moves playback to `target` seconds of the file, kept short of the very end. */
  const seek = (target: number) => {
    const element = videoRef.current
    if (!element) return
    const to = clamp({ value: target, min: 0, max: Math.max(0, (duration ?? Infinity) - 0.5) })
    element.currentTime = to + shift
    position.current = to
    dispatch({ type: 'sought', time: to })
  }

  return {
    state,
    duration,
    position,
    playing,
    fileTime,
    seek,
    /** The browser refused to start playing. */
    refused: () => dispatch({ type: 'paused' }),
  }
}
