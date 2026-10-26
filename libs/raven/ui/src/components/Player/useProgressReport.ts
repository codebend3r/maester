import { type RefObject, useEffect, useEffectEvent, useRef } from 'react'
import type { ProgressSink } from '@/components/Player/PlayerServices'
import type { VideoState } from '@/components/Player/videoState'
import { progressStepOf } from '@/components/Player/watchProgress'

/**
 * Calls `save` whenever the host is about to go away (a page hidden, an app sent to the
 * background), until the returned stop is called.
 */
export type WatchHide = (save: () => void) => () => void

type UseProgressReportProps = {
  state: VideoState
  position: RefObject<number>
  duration: number | null
  /** The audio track playing, which each save names for the admin's Streams page. */
  audio: number | null
  /** Where playback started, the last spot saved until another is. */
  resumeAt: number
  progress: ProgressSink
  watchHide: WatchHide
}

/**
 * Reports a player's progress to `progress` from its state, whatever plays the video: the play
 * once frames flow, the spot on the clock, a pause and the end, the length once known, the
 * spot whenever the host hides, and the last spot as the player goes.
 */
export const useProgressReport = ({
  state,
  position,
  duration,
  audio,
  resumeAt,
  progress,
  watchHide,
}: UseProgressReportProps): void => {
  const lastSaved = useRef(resumeAt)
  const started = useRef(false)
  const previous = useRef(state)
  const reportedDuration = useRef<number | null>(null)

  const save = useEffectEvent((at: number) => {
    if (!started.current || !Number.isFinite(at)) return
    lastSaved.current = at
    progress.save({ position: at, audio })
  })

  useEffect(() => {
    const step = progressStepOf({
      state,
      previous: previous.current,
      hasStarted: started.current,
      lastSaved: lastSaved.current,
      position: position.current,
      duration,
    })
    if (step.isStarting) {
      started.current = true
      progress.started()
    }
    if (step.saveAt !== null) save(step.saveAt)
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
  const watch = useEffectEvent(() => watchHide(() => hide()))
  useEffect(() => {
    const stop = watch()
    return () => {
      stop()
      leave()
    }
  }, [])
}
