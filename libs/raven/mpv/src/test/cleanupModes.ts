import { oneOf } from '@raven/core'

/**
 * How the native cleanup test lets go of its engines: it destroys them, leaves them to its
 * worker's environment teardown, or leaves them to the garbage collector.
 */
export const CLEANUP_MODES = { explicit: 'explicit', environment: 'environment', gc: 'gc' } as const

export const isCleanupMode = oneOf(Object.values(CLEANUP_MODES))
