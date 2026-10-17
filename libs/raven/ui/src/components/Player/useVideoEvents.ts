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

export type MediaListeners = Partial<Record<MediaEventName, (element: HTMLVideoElement) => void>>

/**
 * Listens to the video element's own events for as long as the component
 * lives. Each call answers with the listeners of the latest render, so a
 * hook can hand over closures over its current props without resubscribing.
 */
export const useVideoEvents = ({
  videoRef,
  on,
}: {
  videoRef: RefObject<HTMLVideoElement | null>
  on: MediaListeners
}): void => {
  const handle = useEffectEvent(
    ({ name, element }: { name: MediaEventName; element: HTMLVideoElement }) => on[name]?.(element),
  )
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
