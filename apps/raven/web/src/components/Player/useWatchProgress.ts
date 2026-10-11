import { useQueryClient } from '@tanstack/react-query'
import type { MediaItem } from '@raven/core'
import { type RefObject, useEffect, useEffectEvent, useRef } from 'react'
import { useVideoEvents } from '@/components/Player/useVideoEvents'
import { api } from '@/lib/api'
import { afterWatching } from '@/lib/invalidate'

/** Progress is saved this often while playing, plus on pause and on leaving. */
const SAVE_EVERY_S = 10

/**
 * Keeps the server told where the viewer is: every few seconds of play, on
 * pause, at the end, when the tab closes and when the player does. The
 * first time frames really play, the video joins its library's history.
 */
export const useWatchProgress = ({
  videoRef,
  media,
  position,
  duration,
  fileTime,
}: {
  videoRef: RefObject<HTMLVideoElement | null>
  media: MediaItem
  position: RefObject<number>
  duration: number | null
  fileTime: () => number
}): void => {
  const queryClient = useQueryClient()
  const lastSaved = useRef(media.position)
  // Nothing is saved until frames actually play: a video that never got
  // going still fires `pause` at 0:00 on the way out, and saving that would
  // wipe the place the viewer really stopped.
  const started = useRef(false)

  const save = (at: number) => {
    if (!started.current || !Number.isFinite(at)) return
    lastSaved.current = at
    api.saveProgress({ id: media.id, position: at }).catch(() => undefined)
  }

  useVideoEvents({
    videoRef,
    on: {
      playing: () => {
        if (!started.current) api.recordPlay(media.id).catch(() => undefined)
        started.current = true
      },
      timeupdate: (element) => {
        if (element.readyState < HTMLMediaElement.HAVE_METADATA) return
        const now = fileTime()
        if (Math.abs(now - lastSaved.current) >= SAVE_EVERY_S) save(now)
      },
      pause: (element) => {
        if (element.readyState === HTMLMediaElement.HAVE_NOTHING) return
        save(fileTime())
      },
      ended: () => save(duration ?? fileTime()),
    },
  })

  // Closing the tab mid-film still records the position, and so does leaving the player.
  const leave = useEffectEvent((element: HTMLVideoElement | null) => {
    if (element && element.readyState > 0) save(position.current)
    void afterWatching({ queryClient, libraryId: media.libraryId })
  })
  const hide = useEffectEvent(() => save(position.current))
  useEffect(() => {
    const element = videoRef.current
    window.addEventListener('pagehide', hide)
    return () => {
      window.removeEventListener('pagehide', hide)
      leave(element)
    }
  }, [videoRef])
}
