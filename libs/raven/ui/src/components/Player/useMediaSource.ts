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
import { MEDIA_FAILURE_COPY } from '@/components/Player/copy'
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
  /** A picture subtitle a transcode burns into the picture, by track id; null for none. */
  burn: string | null
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
  burn,
  mime,
  access,
}: SourceForProps): VideoSource =>
  mode === PLAYBACK_MODES.direct || mime == null
    ? { kind: VIDEO_SOURCE_KINDS.file, url: api.fileUrl({ id, access: access() }) }
    : {
        kind: VIDEO_SOURCE_KINDS.stream,
        mime,
        url: (start) => api.streamUrl({ id, mode, start, audio, quality, burn, access: access() }),
      }

/** What a media element's error means to the viewer. */
export const failureMessage = (error: MediaError | null): string => {
  if (error?.code === MediaError.MEDIA_ERR_NETWORK) return MEDIA_FAILURE_COPY.network
  if (error?.code === MediaError.MEDIA_ERR_DECODE) return MEDIA_FAILURE_COPY.decode
  if (error?.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) return MEDIA_FAILURE_COPY.unsupported
  return MEDIA_FAILURE_COPY.stopped
}

/**
 * What the video plays from: who it is (the key a new source re-attaches by), how long the
 * server says it is, and how to build the source once the effect runs.
 */
type SourcePlan = {
  id: string | number
  knownDuration: number | null
  videoSource: (access: () => MediaAccess | null) => VideoSource
}

type PlanOfProps = { source: HtmlSource; rendition: Rendition; audio: number | null }

/** A library file plays its file or a converted stream; a local file plays itself. */
const planOf = ({ source, rendition, audio }: PlanOfProps): SourcePlan => {
  switch (source.kind) {
    case PLAYER_SOURCE_KINDS.server: {
      const { mode, quality, burn } = rendition
      const { media, api } = source
      const mime = mode === PLAYBACK_MODES.direct ? null : streamMimeType({ media, mode })
      return {
        id: media.id,
        knownDuration: media.duration,
        videoSource: (access) =>
          sourceFor({ api, id: media.id, mode, audio, quality, burn, mime, access }),
      }
    }
    case PLAYER_SOURCE_KINDS.file:
      return {
        id: source.url,
        knownDuration: null,
        videoSource: () => ({ kind: VIDEO_SOURCE_KINDS.file, url: source.url }),
      }
    default: {
      const unknown: never = source
      return unknown
    }
  }
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
  /** Null where nothing listens for a stream the connection cannot keep up with. */
  onSlow: ((delivery: Delivery) => void) | null
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
  const { mode, quality, burn } = rendition
  const plan = planOf({ source: htmlSource, rendition, audio })
  const { id, knownDuration } = plan
  // A library file's media plane: the origin and ticket it plays from; a local file has none.
  const plane =
    htmlSource.kind === PLAYER_SOURCE_KINDS.server ? (htmlSource.mediaPlane ?? null) : null
  const access = plane?.access ?? null
  // With an origin named, the video waits for its ticket rather than start through the web host.
  const isAwaitingTicket = !!plane?.isAwaitingTicket
  const accessRef = useRef(access)
  useEffect(() => {
    accessRef.current = access
  }, [access])
  const originUrl = access?.origin.url ?? null
  /*
   * A stream reads the newest ticket on its next request; a <video src> holds
   * its address and would keep asking with the old ticket until it died.
   */
  const fileTicket = mode === PLAYBACK_MODES.direct ? (access?.ticket ?? null) : null
  /*
   * The source this render wants, and the one attached. They differ from
   * the commit that picks a new source until the effect swaps it in, and a
   * failure the browser queued for the old one can land in between; it
   * must not count against the new one. A file's ticket is part of the
   * key because a new ticket re-attaches it.
   */
  const wanted = JSON.stringify([id, mode, audio, quality, burn, originUrl, fileTicket])
  const attached = useRef<string | null>(null)
  const report = (message: string) => {
    if (attached.current === wanted) onFailure(message)
  }
  // A running stream outlives renders; its failures reach the latest `report`.
  const fail = useEffectEvent((message: string) => report(message))
  const slow = useEffectEvent((delivery: Delivery) => {
    if (attached.current === wanted) onSlow?.(delivery)
  })
  const unreachable = useEffectEvent(() => plane?.reportUnreachable())
  const videoSourceNow = useEffectEvent(() => plan.videoSource(() => accessRef.current))

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
    if (!element || isAwaitingTicket) return undefined
    attached.current = wanted
    return attach({
      element,
      source: videoSourceNow(),
      duration: knownDuration,
      isRemote: originUrl !== null,
    })
  }, [videoRef, knownDuration, wanted, originUrl, isAwaitingTicket])
}
