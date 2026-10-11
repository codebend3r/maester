import { type RefObject, useEffect, useEffectEvent, useRef, useState } from 'react'
import type { BezelState } from '@/components/Player/Bezel'

/**
 * Whether the viewer has stirred lately: true on arrival and after any
 * `wake`, false once `ms` pass without one.
 */
export const useIdle = (ms: number): { active: boolean; wake: () => void } => {
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

/** The flash in the middle of the picture; each `flash` restarts it, even with the same words. */
export const useBezel = (): {
  bezel: BezelState | null
  flash: (next: Omit<BezelState, 'id'>) => void
} => {
  const [bezel, setBezel] = useState<BezelState | null>(null)
  return {
    bezel,
    flash: (next) => setBezel((current) => ({ ...next, id: (current?.id ?? 0) + 1 })),
  }
}

/** Whether the stage fills the screen, and the way in and out. */
export const useFullscreen = (
  stage: RefObject<HTMLElement | null>,
): { fullscreen: boolean; toggle: () => void } => {
  const [fullscreen, setFullscreen] = useState(false)
  useEffect(() => {
    const onChange = () => setFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])
  return {
    fullscreen,
    toggle: () => {
      if (document.fullscreenElement) void document.exitFullscreen()
      else void stage.current?.requestFullscreen?.()
    },
  }
}
