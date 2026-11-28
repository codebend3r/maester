import { asksForLessMotion } from '@raven/ui'

/** How a scroll the page makes moves: smoothly, unless the viewer asks for less motion. */
export const scrollBehavior = (): ScrollBehavior => (asksForLessMotion() ? 'auto' : 'smooth')
