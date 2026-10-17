import { type RefObject, useReducer, useRef } from 'react'
import { useVideoEvents } from '@/components/Player/useVideoEvents'

export type Ranges = ReadonlyArray<[number, number]>

/** What the stage draws of the element: where it is, what is loaded, whether it plays. All times are file time. */
export type VideoState = {
  time: number
  /** The element's own idea of the length, for a file the probe could not time. */
  elementDuration: number | null
  buffered: Ranges
  ended: boolean
  paused: boolean
  waiting: boolean
  rate: number
}

export const VIDEO_EVENTS = {
  moved: 'moved',
  sought: 'sought',
  buffered: 'buffered',
  duration: 'duration',
  ended: 'ended',
  played: 'played',
  paused: 'paused',
  waiting: 'waiting',
  flowing: 'flowing',
  rate: 'rate',
} as const

export type VideoEvent =
  | { type: typeof VIDEO_EVENTS.moved; time: number; buffered: Ranges }
  | { type: typeof VIDEO_EVENTS.sought; time: number }
  | { type: typeof VIDEO_EVENTS.buffered; buffered: Ranges }
  | { type: typeof VIDEO_EVENTS.duration; duration: number | null }
  | { type: typeof VIDEO_EVENTS.ended }
  | { type: typeof VIDEO_EVENTS.played }
  | { type: typeof VIDEO_EVENTS.paused }
  | { type: typeof VIDEO_EVENTS.waiting }
  | { type: typeof VIDEO_EVENTS.flowing }
  | { type: typeof VIDEO_EVENTS.rate; rate: number }

export const initialVideoState = (startAt: number): VideoState => ({
  time: startAt,
  elementDuration: null,
  buffered: [],
  ended: false,
  paused: true,
  waiting: false,
  rate: 1,
})

export const videoReducer = (state: VideoState, event: VideoEvent): VideoState => {
  switch (event.type) {
    case VIDEO_EVENTS.moved:
      return { ...state, time: event.time, buffered: event.buffered }
    case VIDEO_EVENTS.sought:
      return { ...state, time: event.time, ended: false }
    case VIDEO_EVENTS.buffered:
      return { ...state, buffered: event.buffered }
    case VIDEO_EVENTS.duration:
      return { ...state, elementDuration: event.duration }
    case VIDEO_EVENTS.ended:
      return { ...state, ended: true }
    case VIDEO_EVENTS.played:
      return { ...state, paused: false, ended: false }
    case VIDEO_EVENTS.paused:
      return { ...state, paused: true }
    case VIDEO_EVENTS.waiting:
      return { ...state, waiting: true }
    case VIDEO_EVENTS.flowing:
      return { ...state, waiting: false }
    case VIDEO_EVENTS.rate:
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
        dispatch({ type: VIDEO_EVENTS.waiting })
        dispatch({ type: VIDEO_EVENTS.played })
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
