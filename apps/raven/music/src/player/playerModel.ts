import { formatDuration } from '@raven/core'

import { PLAYER_COPY } from '@/ui/copy'

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
