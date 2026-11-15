import { useEffect, useEffectEvent, useRef, useState } from 'react'
import type { BezelState } from '@/components/Player/Bezel'

/** Whether the viewer has stirred lately, and the way to say they just did. */
export type Idle = { active: boolean; wake: () => void }

/**
 * Whether the viewer has stirred lately: true on arrival and after any
 * `wake`, false once `ms` pass without one.
 */
export const useIdle = (ms: number): Idle => {
  const [active, setActive] = useState(true)
  const timer = useRef<number | null>(null)
  const clear = () => {
    if (timer.current != null) window.clearTimeout(timer.current)
  }
  const schedule = () => {
    clear()
    timer.current = window.setTimeout(() => setActive(false), ms)
  }
  const start = useEffectEvent(schedule)
  const stop = useEffectEvent(clear)
  useEffect(() => {
    start()
    return () => stop()
  }, [])
  return {
    active,
    wake: () => {
      setActive(true)
      schedule()
    },
  }
}

/** The flash showing, whether it still shows, and the way to show another. */
export type BezelFlash = {
  bezel: BezelState | null
  isFlashing: boolean
  flash: (next: Omit<BezelState, 'id'>) => void
}

/** How long a flash shows: the length of the bezel's animation in `Bezel.module.scss`. */
const BEZEL_MS = 700

const FULLSCREEN_CHANGE = 'fullscreenchange'

/**
 * The flash in the middle of the picture; each `flash` restarts it, even with the same words.
 * `isFlashing` holds while it shows, so nothing else is drawn in the middle under it.
 */
export const useBezel = (): BezelFlash => {
  const [bezel, setBezel] = useState<BezelState | null>(null)
  const [isFlashing, setIsFlashing] = useState(false)
  const id = bezel?.id ?? null
  useEffect(() => {
    if (id === null) return
    const timer = window.setTimeout(() => setIsFlashing(false), BEZEL_MS)
    return () => window.clearTimeout(timer)
  }, [id])
  return {
    bezel,
    isFlashing,
    flash: (next) => {
      setIsFlashing(true)
      setBezel((current) => ({ ...next, id: (current?.id ?? 0) + 1 }))
    },
  }
}

/** Whether the player fills the screen, and the way in and out. */
export type Fullscreen = { fullscreen: boolean; toggle: () => void }

/**
 * Whether the player fills the screen, and the way in and out. The whole
 * page fills it rather than the stage, so the next video in line, which
 * brings a stage of its own, carries on full screen. `useLeaveFullscreen`
 * takes it back when the player goes.
 */
export const useFullscreen = (): Fullscreen => {
  const [fullscreen, setFullscreen] = useState(() => !!document.fullscreenElement)
  useEffect(() => {
    const onChange = () => setFullscreen(!!document.fullscreenElement)
    document.addEventListener(FULLSCREEN_CHANGE, onChange)
    return () => document.removeEventListener(FULLSCREEN_CHANGE, onChange)
  }, [])
  return {
    fullscreen,
    toggle: () => {
      // The browser refuses full screen without a user's gesture; nothing is lost by it.
      const change = document.fullscreenElement
        ? document.exitFullscreen()
        : document.documentElement.requestFullscreen?.()
      change?.catch(() => undefined)
    },
  }
}

/**
 * Leaves the full screen `useFullscreen` filled, once the page the player
 * lives on goes. That page outlasts each video, as the next in line takes
 * the last one's place, so a video ending leaves the screen full.
 */
export const useLeaveFullscreen = (): void =>
  useEffect(
    () => () => {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined)
    },
    [],
  )

/** The time now, read again every `ms`, for a clock on the page that needs no finer step. */
export const useNow = (ms: number): number => {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), ms)
    return () => window.clearInterval(timer)
  }, [ms])
  return now
}
