import { useSyncExternalStore } from 'react'

/** The media query a browser matches while its viewer asks for less motion. */
export const LESS_MOTION = '(prefers-reduced-motion: reduce)'

const QUERY_EVENTS = { change: 'change' } as const

/** Whether the viewer asks for less motion right now. */
export const asksForLessMotion = (): boolean => window.matchMedia(LESS_MOTION).matches

const followLessMotion = (onChange: () => void) => {
  const query = window.matchMedia(LESS_MOTION)
  query.addEventListener(QUERY_EVENTS.change, onChange)
  return () => query.removeEventListener(QUERY_EVENTS.change, onChange)
}

/** Whether the viewer asks for less motion, following the setting as it changes. */
export const useAsksForLessMotion = (): boolean =>
  useSyncExternalStore(followLessMotion, asksForLessMotion)

/** How a scroll the page makes moves: smoothly, unless the viewer asks for less motion. */
export const scrollBehavior = (): ScrollBehavior => (asksForLessMotion() ? 'auto' : 'smooth')
