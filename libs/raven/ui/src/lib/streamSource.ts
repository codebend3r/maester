import { STREAM_TIME_SHIFT } from '@raven/core'

/**
 * Feeds a converted stream to a <video> through Media Source Extensions.
 *
 * The server stamps every fragment with the file's own time plus
 * `STREAM_TIME_SHIFT`, so whatever point a stream starts from, its
 * fragments land where they belong on one timeline. Seeking inside what is
 * buffered is the browser's business; seeking outside it aborts the running
 * request and starts a new stream there. Reading stops while a minute is
 * buffered ahead, which holds ffmpeg back through the pipe, and what is
 * more than half a minute behind is let go. Under memory pressure that
 * back buffer shrinks, so a full buffer cannot strand the playhead.
 *
 * While nothing holds the reading back, the session also times how much
 * video arrives against the clock. A connection that cannot carry the
 * stream as fast as it plays is reported once, so the player can step
 * down to a lighter one instead of stalling every few seconds.
 *
 * The browser objects are described structurally so tests can stand in for
 * them; the real ones satisfy these types.
 */

type Listener = () => void

/** A media source's `readyState`, which the stand-in below types as a plain string. */
export const MEDIA_SOURCE_STATES = { closed: 'closed', open: 'open', ended: 'ended' } as const

/** What a source buffer fires when an append or a removal is done, or has failed. */
export const BUFFER_EVENTS = { updateEnd: 'updateend', error: 'error' } as const

export const ERROR_NAMES = { quotaExceeded: 'QuotaExceededError', abort: 'AbortError' } as const
export const STREAM_EVENTS = {
  timeUpdate: 'timeupdate',
  seeking: 'seeking',
  sourceOpen: 'sourceopen',
  abort: 'abort',
} as const

type Ranges = {
  readonly length: number
  start: (index: number) => number
  end: (index: number) => number
}

export type SourceBufferLike = {
  readonly updating: boolean
  readonly buffered: Ranges
  appendBuffer: (data: Uint8Array<ArrayBuffer>) => void
  remove: (start: number, end: number) => void
  abort: () => void
  addEventListener: (type: string, listener: Listener) => void
  removeEventListener: (type: string, listener: Listener) => void
}

export type MediaSourceLike = {
  readonly readyState: string
  duration: number
  addSourceBuffer: (mime: string) => SourceBufferLike
  endOfStream: () => void
  addEventListener: (type: string, listener: Listener) => void
  removeEventListener: (type: string, listener: Listener) => void
}

export type VideoLike = {
  currentTime: number
  readonly buffered: Ranges
  addEventListener: (type: string, listener: Listener) => void
  removeEventListener: (type: string, listener: Listener) => void
}

type StreamResponse = {
  ok: boolean
  status: number
  body: ReadableStream<Uint8Array<ArrayBuffer>> | null
}

type FetchProps = { signal: AbortSignal }

/**
 * Where the media source comes from and how the video is pointed at it. The
 * environment is made for one video, so `attach` needs only the source, of
 * the very type `createMediaSource` made.
 */
export type StreamEnvironment<S extends MediaSourceLike = MediaSourceLike> = {
  /** Milliseconds on a steady clock, to time delivery by. */
  now: () => number
  createMediaSource: () => S | null
  /** Points the video at the source; the returned function lets go of it again. */
  attach: (source: S) => () => void
  fetch: (url: string, init: FetchProps) => Promise<StreamResponse>
}

export type StreamSession = { destroy: () => void }

/** How fast a stream arrives and how fast it would have to, in bits per second. */
export type Delivery = {
  delivered: number
  /** Null when not a whole frame of video arrived to say what it weighs. */
  needed: number | null
}

/** Where delivery was timed from: the wall clock, the delivered edge and the bytes since. */
type Meter = { wall: number; edge: number; bytes: number }

type SessionState = {
  /** Bumped by every new stream and by destroy, so stale work can tell it is stale. */
  generation: number
  destroyed: boolean
  controller: AbortController | null
  buffer: SourceBufferLike | null
  /** File time the running stream started at, while one runs. */
  streamingFrom: number | null
  detach: () => void
  /** Timing delivery since nothing last held the reading back; null until the next append. */
  meter: Meter | null
  /** A slow stream is reported once a session. */
  reportedSlow: boolean
}

/** Stop reading while this much is buffered ahead of the playhead. */
const MAX_AHEAD_SECONDS = 60
/** Keep this much behind the playhead for quick skips back. */
const KEEP_BEHIND_SECONDS = 30
/** Keep a decoding runway, but not thirty seconds of compressed video, when memory is full. */
const QUOTA_KEEP_BEHIND_SECONDS = 5
/** Batch normal removals instead of making an MSE update on every timeupdate. */
const EVICT_INTERVAL_SECONDS = 5
/** How close to a buffered edge still counts as inside it. */
const EDGE_SECONDS = 0.1
/**
 * A seek this far past what the running stream has delivered waits for it
 * rather than starting over: ffmpeg outruns playback, so it gets there first.
 */
const REACH_SECONDS = 10
/** Wall seconds of free-running delivery timed before judging the connection. */
const SLOW_WINDOW_SECONDS = 15
/**
 * Seconds of video per wall second below which a stream is slow: under one,
 * the playhead catches up with what has arrived and stalls. A 4K remux at
 * nine tenths of real time stalls every half minute or so.
 */
const SLOW_PACE = 1
/**
 * A slow stream with this much buffered ahead is not yet starving the
 * playhead, which keeps a connection that dips for a moment, or a window
 * timed a fragment short, from costing the picture.
 */
const SLOW_AHEAD_SECONDS = 10

const rangesOf = (ranges: Ranges): Array<[number, number]> =>
  Array.from({ length: ranges.length }, (_, index): [number, number] => [
    ranges.start(index),
    ranges.end(index),
  ])

type RangeAtProps = { ranges: Ranges; time: number }

const rangeAt = ({ ranges, time }: RangeAtProps): [number, number] | null =>
  rangesOf(ranges).find(
    ([start, end]) => start - EDGE_SECONDS <= time && time < end - EDGE_SECONDS,
  ) ?? null

type NextEventProps = {
  target: VideoLike
  types: string[]
  signal: AbortSignal | null
}

/** Resolves on the first of `types`; the returned promise never rejects. */
const nextEvent = ({ target, types, signal }: NextEventProps): Promise<void> =>
  new Promise((resolve) => {
    if (signal?.aborted ?? false) {
      resolve()
      return
    }
    const done = () => {
      types.forEach((type) => target.removeEventListener(type, done))
      signal?.removeEventListener(STREAM_EVENTS.abort, done)
      resolve()
    }
    types.forEach((type) => target.addEventListener(type, done))
    signal?.addEventListener(STREAM_EVENTS.abort, done)
  })

const updateEnd = (buffer: SourceBufferLike): Promise<void> =>
  new Promise((resolve, reject) => {
    const finish = () => {
      buffer.removeEventListener(BUFFER_EVENTS.updateEnd, finish)
      buffer.removeEventListener(BUFFER_EVENTS.error, fail)
      resolve()
    }
    const fail = () => {
      buffer.removeEventListener(BUFFER_EVENTS.updateEnd, finish)
      buffer.removeEventListener(BUFFER_EVENTS.error, fail)
      reject(new Error('The browser could not take the converted video.'))
    }
    buffer.addEventListener(BUFFER_EVENTS.updateEnd, finish)
    buffer.addEventListener(BUFFER_EVENTS.error, fail)
  })

const isQuotaError = (error: unknown): boolean =>
  error instanceof Error && error.name === ERROR_NAMES.quotaExceeded

const isAbort = (error: unknown): boolean =>
  error instanceof Error && error.name === ERROR_NAMES.abort

/** The browser's own Media Source Extensions, managed (iOS Safari) or classic, for `video`. */
export const browserEnvironment = (video: HTMLVideoElement): StreamEnvironment<MediaSource> => ({
  createMediaSource: () => {
    const Source = window.ManagedMediaSource ?? window.MediaSource
    return Source ? new Source() : null
  },
  attach: (source) => {
    // ManagedMediaSource only opens when AirPlay is off or has its own source.
    video.disableRemotePlayback = true
    const url = URL.createObjectURL(source)
    video.src = url
    return () => {
      URL.revokeObjectURL(url)
      // The element may already be pointed at something else, such as the
      // original file after stepping back to direct play.
      if (video.src === url) {
        video.removeAttribute('src')
        video.load()
      }
    }
  },
  fetch: (url, init) => window.fetch(url, init),
  now: () => performance.now(),
})

type CreateStreamSessionProps<S extends MediaSourceLike> = {
  video: VideoLike
  mime: string
  /** The file's duration, so the timeline is whole before the stream reaches the end. */
  duration: number | null
  /** File time to start at. */
  start: number
  url: (start: number) => string
  onError: (message: string) => void
  /**
   * A request that was refused before any answer came back, not an abort:
   * the origin could not be reached. Called before `onError` hears of it.
   */
  onUnreachable?: () => void
  /** The connection carries this stream slower than it plays. Called at most once. */
  onSlow?: (delivery: Delivery) => void
  environment: StreamEnvironment<S>
}

export const createStreamSession = <S extends MediaSourceLike>({
  video,
  mime,
  duration,
  start,
  url,
  onError,
  onUnreachable,
  onSlow,
  environment,
}: CreateStreamSessionProps<S>): StreamSession => {
  const state: SessionState = {
    generation: 0,
    destroyed: false,
    controller: null,
    buffer: null,
    streamingFrom: null,
    detach: () => {},
    meter: null,
    reportedSlow: false,
  }
  const source = environment.createMediaSource()

  const fail = (message: string) => {
    if (!state.destroyed) onError(message)
  }

  const current = (generation: number): boolean =>
    !state.destroyed && generation === state.generation

  const settle = async (buffer: SourceBufferLike): Promise<void> => {
    if (buffer.updating) await updateEnd(buffer)
  }

  type EvictBehindProps = {
    buffer: SourceBufferLike
    generation: number
    keepBehind?: number
    interval?: number
  }

  const evictBehind = async ({
    buffer,
    generation,
    keepBehind = KEEP_BEHIND_SECONDS,
    interval = EVICT_INTERVAL_SECONDS,
  }: EvictBehindProps): Promise<boolean> => {
    const cutoff = video.currentTime - keepBehind
    const first = rangesOf(buffer.buffered)[0]
    if (!first || cutoff - first[0] <= interval) return false
    await settle(buffer)
    if (!current(generation)) return false
    buffer.remove(first[0], cutoff)
    await updateEnd(buffer)
    return (rangesOf(buffer.buffered)[0]?.[0] ?? Infinity) > first[0]
  }

  const waitForPlayback = (): Promise<void> =>
    nextEvent({
      target: video,
      types: [STREAM_EVENTS.timeUpdate, STREAM_EVENTS.seeking],
      signal: state.controller?.signal ?? null,
    })

  const ahead = (buffer: SourceBufferLike): number => {
    const range = rangeAt({ ranges: buffer.buffered, time: video.currentTime })
    return range ? range[1] - video.currentTime : 0
  }

  type WaitForRoomProps = {
    buffer: SourceBufferLike
    generation: number
  }

  /** Waits for the playhead to move on while a minute is already buffered. */
  const waitForRoom = async ({ buffer, generation }: WaitForRoomProps): Promise<void> => {
    if (!current(generation) || ahead(buffer) < MAX_AHEAD_SECONDS) return
    // Held back, delivery runs at the pace of playback, not the connection.
    state.meter = null
    await waitForPlayback()
    return waitForRoom({ buffer, generation })
  }

  /** The end of what the running stream has delivered, on the shifted clock. */
  const deliveredEdge = (buffer: SourceBufferLike): number => {
    const from = (state.streamingFrom ?? 0) + STREAM_TIME_SHIFT
    return Math.max(
      from,
      ...rangesOf(buffer.buffered)
        .map(([, end]) => end)
        .filter((end) => end >= from),
    )
  }

  type MeasureProps = { buffer: SourceBufferLike; bytes: number }

  /** Counts an appended chunk, and once a window is timed, judges the connection by it. */
  const measure = ({ buffer, bytes }: MeasureProps) => {
    const now = environment.now()
    const edge = deliveredEdge(buffer)
    const meter = state.meter
    // Timing starts at the first chunk, so ffmpeg's start-up is not held against the connection.
    if (meter == null) {
      state.meter = { wall: now, edge, bytes: 0 }
      return
    }
    const counted = { ...meter, bytes: meter.bytes + bytes }
    const seconds = (now - meter.wall) / 1000
    if (seconds < SLOW_WINDOW_SECONDS) {
      state.meter = counted
      return
    }
    state.meter = { wall: now, edge, bytes: 0 }
    const arrived = edge - meter.edge
    if (state.reportedSlow || arrived / seconds >= SLOW_PACE) return
    if (ahead(buffer) >= SLOW_AHEAD_SECONDS) return
    state.reportedSlow = true
    const bits = counted.bytes * 8
    onSlow?.({ delivered: bits / seconds, needed: arrived > 0 ? bits / arrived : null })
  }

  type AppendProps = {
    buffer: SourceBufferLike
    chunk: Uint8Array<ArrayBuffer>
    generation: number
  }

  const append = async ({ buffer, chunk, generation }: AppendProps): Promise<void> => {
    if (!current(generation)) return
    // Prune even when delivery never gets a minute ahead. Otherwise old
    // frames occupy the quota while a slower stream is trying to catch up.
    await evictBehind({ buffer, generation })
    await waitForRoom({ buffer, generation })
    if (!current(generation)) return
    try {
      await settle(buffer)
      if (!current(generation)) return
      buffer.appendBuffer(chunk)
      await updateEnd(buffer)
    } catch (error) {
      if (!isQuotaError(error)) throw error
      // A full buffer means delivery has outrun playback.
      state.meter = null
      // Thirty seconds can itself exceed the quota. Retaining all of it
      // deadlocks once playback reaches the end and cannot wake this retry.
      const freed = await evictBehind({
        buffer,
        generation,
        keepBehind: QUOTA_KEEP_BEHIND_SECONDS,
        interval: 0,
      })
      if (!current(generation)) return
      if (!freed) await waitForPlayback()
      return append({ buffer, chunk, generation })
    }
  }

  type PumpProps = {
    reader: ReadableStreamDefaultReader<Uint8Array<ArrayBuffer>>
    buffer: SourceBufferLike
    generation: number
  }

  const pump = async ({ reader, buffer, generation }: PumpProps): Promise<void> => {
    if (!current(generation)) {
      await reader.cancel().catch(() => undefined)
      return
    }
    const { done, value } = await reader.read()
    if (!current(generation)) {
      await reader.cancel().catch(() => undefined)
      return
    }
    if (done) {
      await settle(buffer)
      if (current(generation) && source?.readyState === MEDIA_SOURCE_STATES.open) {
        source.endOfStream()
      }
      return
    }
    await append({ buffer, chunk: value, generation })
    if (current(generation)) measure({ buffer, bytes: value.byteLength })
    return pump({ reader, buffer, generation })
  }

  /** Throws away what is buffered and streams from `from` (file time) onwards. */
  const load = async (from: number): Promise<void> => {
    const buffer = state.buffer
    if (!buffer || state.destroyed) return
    state.generation += 1
    const generation = state.generation
    state.controller?.abort()
    const controller = new AbortController()
    state.controller = controller
    state.streamingFrom = from
    state.meter = null
    try {
      // A network read can stop partway through a fragment, and removing
      // what is buffered leaves the parser holding that fragment; the new
      // stream would be read as its rest. Only abort lets go of it, and
      // it throws once the stream has ended, which leaves nothing held.
      if (source?.readyState === MEDIA_SOURCE_STATES.open) buffer.abort()
      if (buffer.buffered.length > 0) {
        buffer.remove(0, Infinity)
        await updateEnd(buffer)
      }
      if (!current(generation)) return
      const response = await environment
        .fetch(url(Math.max(0, from)), { signal: controller.signal })
        .catch((error: unknown) => {
          if (current(generation) && !isAbort(error)) onUnreachable?.()
          throw error
        })
      if (!current(generation)) return
      if (!response.ok || !response.body) {
        fail(`The server could not convert this video (${response.status}).`)
        return
      }
      await pump({ reader: response.body.getReader(), buffer, generation })
    } catch (error) {
      if (current(generation) && !isAbort(error)) {
        fail(error instanceof Error ? error.message : 'The converted video stopped.')
      }
    } finally {
      if (generation === state.generation) state.streamingFrom = null
    }
  }

  type ReachableProps = { buffer: SourceBufferLike; time: number }

  /** Whether the running stream will reach `time` (file time) soon without help. */
  const reachable = ({ buffer, time }: ReachableProps): boolean => {
    const from = state.streamingFrom
    if (from == null) return false
    const edge = deliveredEdge(buffer) - STREAM_TIME_SHIFT
    return from - EDGE_SECONDS <= time && time <= edge + REACH_SECONDS
  }

  const onSeeking = () => {
    const buffer = state.buffer
    if (!buffer || rangeAt({ ranges: buffer.buffered, time: video.currentTime })) return
    const time = video.currentTime - STREAM_TIME_SHIFT
    if (reachable({ buffer, time })) return
    void load(time)
  }

  const onOpen = () => {
    // MSE fires sourceopen again when a seek reopens an ended source.
    if (!source || state.destroyed || state.buffer) return
    try {
      state.buffer = source.addSourceBuffer(mime)
    } catch {
      fail("This browser can't play the converted video.")
      return
    }
    if (duration != null && duration > 0) source.duration = duration + STREAM_TIME_SHIFT
    video.currentTime = start + STREAM_TIME_SHIFT
    video.addEventListener(STREAM_EVENTS.seeking, onSeeking)
    void load(start)
  }

  if (!source) {
    // Reported on the next tick, so the caller has its session before hearing about it.
    queueMicrotask(() => fail("This browser can't play converted video."))
  } else {
    source.addEventListener(STREAM_EVENTS.sourceOpen, onOpen)
    state.detach = environment.attach(source)
  }

  return {
    destroy: () => {
      state.destroyed = true
      state.generation += 1
      state.controller?.abort()
      video.removeEventListener(STREAM_EVENTS.seeking, onSeeking)
      source?.removeEventListener(STREAM_EVENTS.sourceOpen, onOpen)
      state.detach()
    },
  }
}
