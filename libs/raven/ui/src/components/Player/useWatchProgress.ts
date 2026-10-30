import type { RefObject } from 'react'
import { useHostServices } from '@/stores/playerServices'
import { useProgressReport } from '@/components/Player/useProgressReport'
import type { VideoState } from '@/components/Player/videoState'
import { watchPageHide } from '@/components/Player/watchPageHide'

type UseWatchProgressProps = {
  state: VideoState
  position: RefObject<number>
  duration: number | null
  /** The audio track playing, which each save names for the admin's Streams page. */
  audio: number | null
}

/** Progress follows engine state, not a particular engine's DOM events. */
export const useWatchProgress = ({
  state,
  position,
  duration,
  audio,
}: UseWatchProgressProps): void => {
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
