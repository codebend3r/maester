import {
  SERVER_STREAM_EVENTS,
  SERVER_STREAM_STATES,
  type ServerEventSource,
} from '@raven/ui/headless'

type StreamEvent = Parameters<ServerEventSource['addEventListener']>[0]
type Listener = Parameters<ServerEventSource['addEventListener']>[1]

/** The part of `react-native-sse`'s `EventSource` the app uses: only a message carries `data`. */
export type NativeEventSource = {
  addEventListener: (
    type: StreamEvent,
    listener: (event: { type: string; data?: string | null }) => void,
  ) => void
  close: () => void
}

/** Runs `run` after `ms`; returns the way to cancel it. */
export type Schedule = (wait: { run: () => void; ms: number }) => () => void

/** Whether the app is in the foreground, and the way to hear when that changes. */
export type AppActivity = {
  isForeground: () => boolean
  watch: (onChange: (isForeground: boolean) => void) => () => void
}

/** What React Native's `AppState` reports. */
export const APP_STATES = {
  active: 'active',
  inactive: 'inactive',
  background: 'background',
} as const

/**
 * Whether the app counts as in the foreground in `state`. Only the background closes the
 * stream: `inactive` is Control Center, a call or the app switcher passing over the app,
 * which comes back without the stream having to.
 */
export const isForegroundState = (state: string): boolean => state !== APP_STATES.background

/**
 * How long a dropped stream waits before it opens again: doubling from a second, to half a
 * minute, and back to a second only once a connection has held for `held`, so a proxy that
 * accepts and then resets each one is not asked again every second.
 */
export const RECONNECT_MS = { first: 1000, most: 30_000, held: 5000 } as const

const STREAM_EVENTS = Object.values(SERVER_STREAM_EVENTS)

type Stream = {
  source: NativeEventSource | null
  isOpening: boolean
  isClosed: boolean
  isForeground: boolean
  /** Failed opens since the last that held, which sets the next wait. */
  attempt: number
  cancelWait: (() => void) | null
  /** Cancels the count of an open connection's first seconds, after which it has held. */
  cancelHold: (() => void) | null
  /** Bumped whenever the stream is dropped, so an open still reading its headers gives up. */
  generation: number
}

/**
 * The `openEvents` that `serverEventsFor` takes, over `react-native-sse`. React Native has no
 * `EventSource`, and the stream needs the server's cookies, which the jar reads
 * asynchronously, so each connection opens once they are read.
 *
 * The library retries only an answer that came back with an error status: a refused or reset
 * connection, as when the server restarts or the system drops the request in the background,
 * leaves it dead. So the stream reopens itself after every `error`, waiting from
 * `RECONNECT_MS.first` and doubling to `RECONNECT_MS.most`, and starts over from the first
 * wait once one has held for `RECONNECT_MS.held`. It closes while the app is in the
 * background and opens again on its return; the listeners hear an `error` as it closes, so
 * headless reads everything again once it is back. At most one connection is open at a
 * time, and none after `close`.
 */
export const eventSourceFor =
  ({
    headersFor,
    createSource,
    schedule,
    app,
  }: {
    headersFor: (url: string) => Promise<Record<string, string>>
    createSource: (source: { url: string; headers: Record<string, string> }) => NativeEventSource
    schedule: Schedule
    app: AppActivity
  }) =>
  (url: string): ServerEventSource => {
    const listeners: Array<{ type: StreamEvent; listener: Listener }> = []
    const stream: Stream = {
      source: null,
      isOpening: false,
      isClosed: false,
      isForeground: app.isForeground(),
      attempt: 0,
      cancelWait: null,
      cancelHold: null,
      generation: 0,
    }

    const hear = ({ type, data }: { type: StreamEvent; data?: string | null }) =>
      listeners.filter((entry) => entry.type === type).forEach(({ listener }) => listener({ data }))

    const drop = () => {
      if (stream.source !== null) stream.source.close()
      if (stream.cancelWait !== null) stream.cancelWait()
      if (stream.cancelHold !== null) stream.cancelHold()
      stream.source = null
      stream.cancelWait = null
      stream.cancelHold = null
      stream.isOpening = false
      stream.generation += 1
    }

    const retry = () => {
      drop()
      if (stream.isClosed || !stream.isForeground) return
      const ms = Math.min(RECONNECT_MS.first * 2 ** stream.attempt, RECONNECT_MS.most)
      stream.attempt += 1
      stream.cancelWait = schedule({
        run: () => {
          stream.cancelWait = null
          connect()
        },
        ms,
      })
    }

    const countHold = () => {
      stream.cancelHold = schedule({
        run: () => {
          stream.cancelHold = null
          stream.attempt = 0
        },
        ms: RECONNECT_MS.held,
      })
    }

    const follow = (source: NativeEventSource) =>
      STREAM_EVENTS.forEach((type) =>
        source.addEventListener(type, (event) => {
          if (stream.source !== source) return
          if (type === SERVER_STREAM_EVENTS.error) retry()
          if (type === SERVER_STREAM_EVENTS.open && stream.cancelHold === null) countHold()
          hear({ type, data: event.data })
        }),
      )

    const connect = () => {
      const isWaiting = stream.source !== null || stream.isOpening || stream.cancelWait !== null
      if (stream.isClosed || !stream.isForeground || isWaiting) return
      stream.isOpening = true
      const { generation } = stream
      void headersFor(url)
        .then((headers) => {
          if (generation !== stream.generation) return
          const source = createSource({ url, headers })
          stream.isOpening = false
          stream.source = source
          follow(source)
        })
        .catch(() => {
          if (generation !== stream.generation) return
          hear({ type: SERVER_STREAM_EVENTS.error })
          retry()
        })
    }

    const stopWatching = app.watch((isForeground) => {
      stream.isForeground = isForeground
      if (isForeground) {
        stream.attempt = 0
        connect()
        return
      }
      const hasSource = stream.source !== null
      drop()
      if (hasSource) hear({ type: SERVER_STREAM_EVENTS.error })
    })

    connect()

    return {
      // Closed only once headless closes it: until then it opens again on its own, so headless never retries.
      get readyState() {
        return stream.isClosed ? SERVER_STREAM_STATES.closed : SERVER_STREAM_STATES.connecting
      },
      addEventListener: (type, listener) => {
        listeners.push({ type, listener })
      },
      close: () => {
        stream.isClosed = true
        drop()
        stopWatching()
      },
    }
  }
