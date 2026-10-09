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
 * more than half a minute behind is let go.
 *
 * The browser objects are described structurally so tests can stand in for
 * them; the real ones satisfy these types.
 */

type Listener = () => void

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

export type StreamResponse = {
  ok: boolean
  status: number
  body: ReadableStream<Uint8Array<ArrayBuffer>> | null
}

export type StreamEnvironment = {
  createMediaSource: () => MediaSourceLike | null
  /** Points the video at the source; the returned function lets go of it again. */
  attach: ({ video, source }: { video: VideoLike; source: MediaSourceLike }) => () => void
  fetch: (url: string, init: { signal: AbortSignal }) => Promise<StreamResponse>
}

export type StreamSession = { destroy: () => void }

/** Stop reading while this much is buffered ahead of the playhead. */
const MAX_AHEAD_SECONDS = 60
/** Keep this much behind the playhead for quick skips back. */
const KEEP_BEHIND_SECONDS = 30
/** How close to a buffered edge still counts as inside it. */
const EDGE_SECONDS = 0.1
/**
 * A seek this far past what the running stream has delivered waits for it
 * rather than starting over: ffmpeg outruns playback, so it gets there first.
 */
const REACH_SECONDS = 10

const rangesOf = (ranges: Ranges): Array<[number, number]> =>
  Array.from({ length: ranges.length }, (_, index): [number, number] => [
    ranges.start(index),
    ranges.end(index),
  ])

const rangeAt = ({ ranges, time }: { ranges: Ranges; time: number }): [number, number] | null =>
  rangesOf(ranges).find(
    ([start, end]) => start - EDGE_SECONDS <= time && time < end - EDGE_SECONDS,
  ) ?? null

/** Resolves on the first of `types`; the returned promise never rejects. */
const nextEvent = ({ target, types }: { target: VideoLike; types: string[] }): Promise<void> =>
  new Promise((resolve) => {
    const done = () => {
      types.forEach((type) => target.removeEventListener(type, done))
      resolve()
    }
    types.forEach((type) => target.addEventListener(type, done))
  })

const updateEnd = (buffer: SourceBufferLike): Promise<void> =>
  new Promise((resolve, reject) => {
    const finish = () => {
      buffer.removeEventListener('updateend', finish)
      buffer.removeEventListener('error', fail)
      resolve()
    }
    const fail = () => {
      buffer.removeEventListener('updateend', finish)
      buffer.removeEventListener('error', fail)
      reject(new Error('The browser could not take the converted video.'))
    }
    buffer.addEventListener('updateend', finish)
    buffer.addEventListener('error', fail)
  })

const isQuotaError = (error: unknown): boolean =>
  error instanceof Error && error.name === 'QuotaExceededError'

const isAbort = (error: unknown): boolean => error instanceof Error && error.name === 'AbortError'

/** The browser's own Media Source Extensions, managed (iOS Safari) or classic. */
const browserEnvironment = (): StreamEnvironment => ({
  createMediaSource: () => {
    const Source = window.ManagedMediaSource ?? window.MediaSource
    return Source ? new Source() : null
  },
  attach: ({ video, source }) => {
    if (!(video instanceof HTMLVideoElement) || !(source instanceof MediaSource)) return () => {}
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
})

export const createStreamSession = ({
  video,
  mime,
  duration,
  start,
  url,
  onError,
  environment = browserEnvironment(),
}: {
  video: VideoLike
  mime: string
  /** The file's duration, so the timeline is whole before the stream reaches the end. */
  duration: number | null
  /** File time to start at. */
  start: number
  url: (start: number) => string
  onError: (message: string) => void
  environment?: StreamEnvironment
}): StreamSession => {
  const state = {
    generation: 0,
    destroyed: false,
    controller: null as AbortController | null,
    buffer: null as SourceBufferLike | null,
    /** File time the running stream started at, while one runs. */
    streamingFrom: null as number | null,
    detach: () => {},
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

  const evictBehind = async (buffer: SourceBufferLike): Promise<boolean> => {
    const cutoff = video.currentTime - KEEP_BEHIND_SECONDS
    const first = rangesOf(buffer.buffered)[0]
    if (!first || first[0] >= cutoff) return false
    await settle(buffer)
    buffer.remove(first[0], cutoff)
    await updateEnd(buffer)
    return true
  }

  const ahead = (buffer: SourceBufferLike): number => {
    const range = rangeAt({ ranges: buffer.buffered, time: video.currentTime })
    return range ? range[1] - video.currentTime : 0
  }

  /** Waits for the playhead to move on while a minute is already buffered. */
  const waitForRoom = async ({
    buffer,
    generation,
  }: {
    buffer: SourceBufferLike
    generation: number
  }): Promise<void> => {
    if (!current(generation) || ahead(buffer) < MAX_AHEAD_SECONDS) return
    await evictBehind(buffer)
    await nextEvent({ target: video, types: ['timeupdate', 'seeking'] })
    return waitForRoom({ buffer, generation })
  }

  const append = async ({
    buffer,
    chunk,
    generation,
  }: {
    buffer: SourceBufferLike
    chunk: Uint8Array<ArrayBuffer>
    generation: number
  }): Promise<void> => {
    await waitForRoom({ buffer, generation })
    if (!current(generation)) return
    try {
      await settle(buffer)
      buffer.appendBuffer(chunk)
      await updateEnd(buffer)
    } catch (error) {
      if (!isQuotaError(error)) throw error
      // Full: let go of what is behind, or wait for playback to use some up.
      const freed = await evictBehind(buffer)
      if (!freed) await nextEvent({ target: video, types: ['timeupdate', 'seeking'] })
      return append({ buffer, chunk, generation })
    }
  }

  const pump = async ({
    reader,
    buffer,
    generation,
  }: {
    reader: ReadableStreamDefaultReader<Uint8Array<ArrayBuffer>>
    buffer: SourceBufferLike
    generation: number
  }): Promise<void> => {
    const { done, value } = await reader.read()
    if (!current(generation)) {
      await reader.cancel().catch(() => undefined)
      return
    }
    if (done) {
      await settle(buffer)
      if (current(generation) && source?.readyState === 'open') source.endOfStream()
      return
    }
    await append({ buffer, chunk: value, generation })
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
    try {
      if (buffer.updating) buffer.abort()
      if (buffer.buffered.length > 0) {
        buffer.remove(0, Infinity)
        await updateEnd(buffer)
      }
      if (!current(generation)) return
      const response = await environment.fetch(url(Math.max(0, from)), {
        signal: controller.signal,
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

  /** Whether the running stream will reach `time` (file time) soon without help. */
  const reachable = ({ buffer, time }: { buffer: SourceBufferLike; time: number }): boolean => {
    const from = state.streamingFrom
    if (from == null) return false
    const delivered = rangesOf(buffer.buffered)
      .map(([, end]) => end - STREAM_TIME_SHIFT)
      .filter((end) => end >= from)
    const edge = Math.max(from, ...delivered)
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
    if (!source || state.destroyed) return
    try {
      state.buffer = source.addSourceBuffer(mime)
    } catch {
      fail("This browser can't play the converted video.")
      return
    }
    if (duration != null && duration > 0) source.duration = duration + STREAM_TIME_SHIFT
    video.currentTime = start + STREAM_TIME_SHIFT
    video.addEventListener('seeking', onSeeking)
    void load(start)
  }

  if (!source) {
    // Reported on the next tick, so the caller has its session before hearing about it.
    queueMicrotask(() => fail("This browser can't play converted video."))
  } else {
    source.addEventListener('sourceopen', onOpen)
    state.detach = environment.attach({ video, source })
  }

  return {
    destroy: () => {
      state.destroyed = true
      state.generation += 1
      state.controller?.abort()
      video.removeEventListener('seeking', onSeeking)
      source?.removeEventListener('sourceopen', onOpen)
      state.detach()
    },
  }
}
