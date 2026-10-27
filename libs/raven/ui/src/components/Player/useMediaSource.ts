import {
  type ApiClient,
  type MediaAccess,
  PLAYBACK_MODES,
  PLAYER_SOURCE_KINDS,
  type PlaybackMode,
  type StreamQuality,
  streamMimeType,
} from '@raven/core'
import { type RefObject, useEffect, useEffectEvent, useRef } from 'react'
import { useVideoEvents } from '@/components/Player/useVideoEvents'
import type { HtmlSource } from '@/components/Player/engine'
import type { Rendition } from '@/components/Player/rendition'
import { type Delivery, browserEnvironment, createStreamSession } from '@/lib/streamSource'

export const VIDEO_SOURCE_KINDS = { file: 'file', stream: 'stream' } as const

/** What the video plays: the file itself, or a converted stream of a known type. */
export type VideoSource =
  | { kind: typeof VIDEO_SOURCE_KINDS.file; url: string }
  | { kind: typeof VIDEO_SOURCE_KINDS.stream; mime: string; url: (start: number) => string }

type SourceForProps = {
  api: ApiClient
  id: number
  mode: PlaybackMode
  /** The `0:a:N` track to play, or null for the file's default. */
  audio: number | null
  /** The size a transcode is asked for; null for the server's settings. */
  quality?: StreamQuality | null
  /** The converted stream's type; null for direct play, which needs none. */
  mime: string | null
  /** Read for each URL built, so a stream's next request carries the newest ticket. */
  access: () => MediaAccess | null
}

export const sourceFor = ({
  api,
  id,
  mode,
  audio,
  quality = null,
  mime,
  access,
}: SourceForProps): VideoSource =>
  mode === PLAYBACK_MODES.direct || mime == null
    ? { kind: VIDEO_SOURCE_KINDS.file, url: api.fileUrl({ id, access: access() }) }
    : {
        kind: VIDEO_SOURCE_KINDS.stream,
        mime,
        url: (start) => api.streamUrl({ id, mode, start, audio, quality, access: access() }),
      }

const failureMessage = (error: MediaError | null): string => {
  if (error?.code === MediaError.MEDIA_ERR_NETWORK) return 'The connection to the server dropped.'
  if (error?.code === MediaError.MEDIA_ERR_DECODE) return "The browser couldn't decode this file."
  if (error?.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) {
    return "The browser couldn't open this file."
  }
  return 'Playback stopped unexpectedly.'
}

type UseMediaSourceProps = {
  videoRef: RefObject<HTMLVideoElement | null>
  source: HtmlSource
  rendition: Rendition
  audio: number | null
  position: RefObject<number>
  playing: RefObject<boolean>
  /** The browser would not start playing. */
  onRefused: () => void
  onFailure: (message: string) => void
  onSlow?: (delivery: Delivery) => void
}

/**
 * Points the video at its source: the file itself, or a converted stream
 * through Media Source Extensions. A change of mode or audio track rebuilds
 * it where playback was, playing on if it was playing. A source that fails
 * says why through `onFailure`, and a stream the connection cannot keep up
 * with says so through `onSlow`.
 */
export const useMediaSource = ({
  videoRef,
  source: htmlSource,
  rendition,
  audio,
  position,
  playing,
  onRefused,
  onFailure,
  onSlow,
}: UseMediaSourceProps): void => {
  const { mode, quality } = rendition
  const mime =
    mode === PLAYBACK_MODES.direct || htmlSource.kind === PLAYER_SOURCE_KINDS.file
      ? null
      : streamMimeType({ media: htmlSource.media, mode })
  const id = htmlSource.kind === PLAYER_SOURCE_KINDS.server ? htmlSource.media.id : htmlSource.url
  const api = htmlSource.kind === PLAYER_SOURCE_KINDS.server ? htmlSource.api : null
  const knownDuration =
    htmlSource.kind === PLAYER_SOURCE_KINDS.server ? htmlSource.media.duration : null
  const access =
    htmlSource.kind === PLAYER_SOURCE_KINDS.server ? (htmlSource.mediaPlane?.access ?? null) : null
  const accessRef = useRef(access)
  useEffect(() => {
    accessRef.current = access
  }, [access])
  const originUrl = access?.origin.url ?? null
  // A stream reads the newest ticket on its next request; a <video src> holds
  // its address and would keep asking with the old ticket until it died.
  const fileTicket = mode === PLAYBACK_MODES.direct ? (access?.ticket ?? null) : null
  // The source this render wants, and the one attached. They differ from
  // the commit that picks a new source until the effect swaps it in, and a
  // failure the browser queued for the old one can land in between; it
  // must not count against the new one. A file's ticket is part of the
  // key because a new ticket re-attaches it.
  const wanted = JSON.stringify([id, mode, audio, quality, originUrl, fileTicket])
  const attached = useRef<string | null>(null)
  const report = (message: string) => {
    if (attached.current === wanted) onFailure(message)
  }
  // A running stream outlives renders; its failures reach the latest `report`.
  const fail = useEffectEvent((message: string) => report(message))
  const slow = useEffectEvent((delivery: Delivery) => {
    if (attached.current === wanted) onSlow?.(delivery)
  })
  const unreachable = useEffectEvent(() => {
    if (htmlSource.kind === PLAYER_SOURCE_KINDS.server) htmlSource.mediaPlane?.reportUnreachable()
  })

  useVideoEvents({
    videoRef,
    on: {
      error: (element) => {
        if (element.getAttribute('src')) report(failureMessage(element.error))
      },
    },
  })

  type AttachProps = {
    element: HTMLVideoElement
    source: VideoSource
    duration: number | null
    /** Whether the media comes from an origin that could prove unreachable. */
    isRemote: boolean
  }

  // Starts the source where playback is, playing on if it was.
  const attach = useEffectEvent(
    ({ element, source, duration, isRemote }: AttachProps): (() => void) => {
      const from = position.current
      const play = () => {
        if (playing.current) element.play()?.catch(() => onRefused())
      }
      if (source.kind === VIDEO_SOURCE_KINDS.file) {
        const onReady = () => {
          if (from > 0) element.currentTime = from
          play()
        }
        element.addEventListener('loadedmetadata', onReady, { once: true })
        element.src = source.url
        return () => {
          element.removeEventListener('loadedmetadata', onReady)
          element.removeAttribute('src')
          element.load()
        }
      }
      const session = createStreamSession({
        video: element,
        mime: source.mime,
        duration,
        start: from,
        url: source.url,
        onError: (message) => fail(message),
        onUnreachable: isRemote ? () => unreachable() : undefined,
        onSlow: (delivery) => slow(delivery),
        environment: browserEnvironment(element),
      })
      play()
      return () => session.destroy()
    },
  )

  useEffect(() => {
    const element = videoRef.current
    if (!element) return undefined
    attached.current = wanted
    const videoSource: VideoSource =
      api != null && typeof id === 'number'
        ? sourceFor({ api, id, mode, audio, quality, mime, access: () => accessRef.current })
        : { kind: 'file', url: String(id) }
    return attach({
      element,
      source: videoSource,
      duration: knownDuration,
      isRemote: originUrl != null,
    })
  }, [videoRef, id, knownDuration, api, mode, audio, quality, mime, wanted, originUrl])
}
