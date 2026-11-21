import { formatDuration } from '@raven/core'

import { PLAYER_COPY } from '@/copy/kit'

type ProgressOfProps = { position: number; length: number }

/** How far through the track it is, from 0 to 1, and none while its length is unknown. */
export const progressOf = ({ position, length }: ProgressOfProps): number =>
  length > 0 ? Math.min(1, position / length) : 0

/** How long is left, as the scrubber's right end says it: "-1:09". */
export const remainingTextOf = ({ position, length }: ProgressOfProps): string =>
  PLAYER_COPY.remaining(formatDuration(Math.max(0, length - position)))

/** Where the scrubber stands, read out: "1:02 of 4:44". */
export const scrubTextOf = ({ position, length }: ProgressOfProps): string =>
  PLAYER_COPY.scrubText({ at: formatDuration(position), length: formatDuration(length) })

/**
 * Where the transport is drawn: the player's, the lyrics', Up next's, the player bar's and the
 * narrow column of the wide Now Playing.
 */
export const TRANSPORTS = {
  player: 'player',
  lyrics: 'lyrics',
  queue: 'queue',
  bar: 'bar',
  column: 'column',
} as const

export type TransportKind = (typeof TRANSPORTS)[keyof typeof TRANSPORTS]

/** Whether Shuffle and Repeat flank the transport; Up next's head holds its own. */
export const hasTogglesOf = (kind: TransportKind): boolean => kind !== TRANSPORTS.queue

/** The transport's two steps through the queue, each named as the queue's own action is. */
export const STEPS = { previous: 'previous', next: 'next' } as const

export type Step = (typeof STEPS)[keyof typeof STEPS]
