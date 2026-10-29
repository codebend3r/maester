import { type RefObject, useEffect, useEffectEvent } from 'react'

const MEDIA_EVENTS = [
  'loadedmetadata',
  'durationchange',
  'timeupdate',
  'seeked',
  'progress',
  'play',
  'playing',
  'waiting',
  'canplay',
  'pause',
  'ended',
  'ratechange',
  'volumechange',
  'error',
] as const

type MediaEventName = (typeof MEDIA_EVENTS)[number]

type MediaListeners<E extends HTMLMediaElement> = Partial<
  Record<MediaEventName, (element: E) => void>
>

type UseVideoEventsProps<E extends HTMLMediaElement> = {
  videoRef: RefObject<E | null>
  on: MediaListeners<E>
}

/**
 * Listens to the media element's own events, a video's or an audio's, for
 * as long as the component lives. Each call answers with the listeners of the latest render, so a
 * hook can hand over closures over its current props without resubscribing.
 */
export const useVideoEvents = <E extends HTMLMediaElement>({
  videoRef,
  on,
}: UseVideoEventsProps<E>): void => {
  type HandleProps = { name: MediaEventName; element: E }

  const handle = useEffectEvent(({ name, element }: HandleProps) => on[name]?.(element))
  useEffect(() => {
    const element = videoRef.current
    if (!element) return undefined
    const unsubscribe = MEDIA_EVENTS.map((name) => {
      const listener = () => handle({ name, element })
      element.addEventListener(name, listener)
      return () => element.removeEventListener(name, listener)
    })
    return () => unsubscribe.forEach((stop) => stop())
  }, [videoRef])
}
