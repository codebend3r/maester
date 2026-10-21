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
