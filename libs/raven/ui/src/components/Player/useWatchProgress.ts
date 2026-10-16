import { type RefObject, useEffect, useEffectEvent, useRef } from 'react'
import { usePlayerServices } from '@/components/Player/PlayerServices'
import type { VideoState } from '@/components/Player/useVideoState'

const SAVE_EVERY_S = 10

/** Progress follows engine state, not a particular engine's DOM events. */
export const useWatchProgress = ({
  state,
  position,
  duration,
}: {
  state: VideoState
  position: RefObject<number>
  duration: number | null
}): void => {
  const { progress, title } = usePlayerServices()
  const lastSaved = useRef(title.resumeAt)
  const started = useRef(false)
  const previous = useRef(state)
  const reportedDuration = useRef<number | null>(null)

  const save = useEffectEvent((at: number) => {
    if (!started.current || !Number.isFinite(at)) return
    lastSaved.current = at
    progress.save(at)
  })

  useEffect(() => {
    if (!started.current && !state.paused && !state.waiting) {
      started.current = true
      progress.started()
    }
    if (state.ended && !previous.current.ended) save(duration ?? position.current)
    else if (
      (state.paused && !previous.current.paused) ||
      Math.abs(state.time - lastSaved.current) >= SAVE_EVERY_S
    )
      save(position.current)
    previous.current = state
  }, [state, duration, position, progress])

  useEffect(() => {
    if (duration == null || !Number.isFinite(duration) || duration <= 0) return
    if (reportedDuration.current === duration) return
    reportedDuration.current = duration
    if (!progress.duration) return
    progress.duration(duration)
  }, [duration, progress])

  const leave = useEffectEvent(() => {
    save(position.current)
    progress.left(position.current)
  })
  const hide = useEffectEvent(() => save(position.current))
  useEffect(() => {
    window.addEventListener('pagehide', hide)
    return () => {
      window.removeEventListener('pagehide', hide)
      leave()
    }
  }, [])
}
