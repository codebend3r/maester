import type { LyricLine } from '@raven/core'

type ActiveLineAtProps = {
  /** Synced lines in time order, as the server sends them. */
  lines: readonly LyricLine[]
  /** Seconds into the track. */
  at: number
}

/** The place of the line being sung at `at`: the last to have started, or null before the first. */
export const activeLineAt = ({ lines, at }: ActiveLineAtProps): number | null => {
  const place = lines.findLastIndex((line) => line.at <= at)
  return place === -1 ? null : place
}
