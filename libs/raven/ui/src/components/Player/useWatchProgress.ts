import type { RefObject } from 'react'
import { useHostServices } from '@/stores/playerServices'
import { type WatchHide, useProgressReport } from '@/components/Player/useProgressReport'
import type { VideoState } from '@/components/Player/videoState'

const PAGE_EVENTS = { hide: 'pagehide' } as const

const watchPageHide: WatchHide = (save) => {
  window.addEventListener(PAGE_EVENTS.hide, save)
  return () => window.removeEventListener(PAGE_EVENTS.hide, save)
}

/** Progress follows engine state, not a particular engine's DOM events. */
export const useWatchProgress = ({
  state,
  position,
  duration,
  audio,
}: {
  state: VideoState
  position: RefObject<number>
  duration: number | null
  /** The audio track playing, which each save names for the admin's Streams page. */
  audio: number | null
}): void => {
  const { progress, title } = useHostServices()
  useProgressReport({
    state,
    position,
    duration,
    audio,
    resumeAt: title.resumeAt,
    progress,
    watchHide: watchPageHide,
  })
}
