import { type ApiClient, type PlaybackMode, streamMimeType } from '@raven/core'
import { type RefObject, useEffect, useEffectEvent, useRef } from 'react'
import { useVideoEvents } from '@/components/Player/useVideoEvents'
import type { HtmlSource } from '@/components/Player/engine'
import { browserEnvironment, createStreamSession } from '@/lib/streamSource'

/** What the video plays: the file itself, or a converted stream of a known type. */
export type VideoSource =
  | { kind: 'file'; url: string }
  | { kind: 'stream'; mime: string; url: (start: number) => string }

export const sourceFor = ({
  api,
  id,
  mode,
  audio,
  mime,
}: {
  api: ApiClient
  id: number
  mode: PlaybackMode
  /** The `0:a:N` track to play, or null for the file's default. */
  audio: number | null
  /** The converted stream's type; null for direct play, which needs none. */
  mime: string | null
}): VideoSource =>
  mode === 'direct' || mime == null
    ? { kind: 'file', url: api.fileUrl({ id }) }
    : { kind: 'stream', mime, url: (start) => api.streamUrl({ id, mode, start, audio }) }

const failureMessage = (error: MediaError | null): string => {
  if (error?.code === MediaError.MEDIA_ERR_NETWORK) return 'The connection to the server dropped.'
  if (error?.code === MediaError.MEDIA_ERR_DECODE) return "The browser couldn't decode this file."
  if (error?.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) {
    return "The browser couldn't open this file."
  }
  return 'Playback stopped unexpectedly.'
}

/**
 * Points the video at its source: the file itself, or a converted stream
 * through Media Source Extensions. A change of mode or audio track rebuilds
 * it where playback was, playing on if it was playing. A source that fails
 * says why through `onFailure`.
 */
export const useMediaSource = ({
  videoRef,
  source: htmlSource,
  mode,
  audio,
  position,
  playing,
  onRefused,
  onFailure,
}: {
  videoRef: RefObject<HTMLVideoElement | null>
  source: HtmlSource
  mode: PlaybackMode
  audio: number | null
  position: RefObject<number>
  playing: RefObject<boolean>
  /** The browser would not start playing. */
  onRefused: () => void
  onFailure: (message: string) => void
}): void => {
  const mime =
    mode === 'direct' || htmlSource.kind === 'file'
      ? null
      : streamMimeType({ media: htmlSource.media, mode })
  const id = htmlSource.kind === 'server' ? htmlSource.media.id : htmlSource.url
  const api = htmlSource.kind === 'server' ? htmlSource.api : null
  const knownDuration = htmlSource.kind === 'server' ? htmlSource.media.duration : null
  // The source this render wants, and the one attached. They differ from
  // the commit that picks a new source until the effect swaps it in, and a
  // failure the browser queued for the old one can land in between; it
  // must not count against the new one.
  const wanted = `${id}:${mode}:${audio ?? 'default'}`
  const attached = useRef<string | null>(null)
  const report = (message: string) => {
    if (attached.current === wanted) onFailure(message)
  }
  // A running stream outlives renders; its failures reach the latest `report`.
  const fail = useEffectEvent((message: string) => report(message))

  useVideoEvents({
    videoRef,
    on: {
      error: (element) => {
        if (element.getAttribute('src')) report(failureMessage(element.error))
      },
    },
  })

  // Starts the source where playback is, playing on if it was.
  const attach = useEffectEvent(
    ({
      element,
      source,
      duration,
    }: {
      element: HTMLVideoElement
      source: VideoSource
      duration: number | null
    }): (() => void) => {
      const from = position.current
      const play = () => {
        if (playing.current) element.play()?.catch(() => onRefused())
      }
      if (source.kind === 'file') {
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
        ? sourceFor({ api, id, mode, audio, mime })
        : { kind: 'file', url: String(id) }
    return attach({ element, source: videoSource, duration: knownDuration })
  }, [videoRef, id, knownDuration, api, mode, audio, mime, wanted])
}
