import { formatCount, plural } from '@raven/core'

import { COUNTS_COPY, factsLineOf } from '@/copy/kit'

/** What a line counts, in the order it counts them. */
const COUNT_ORDER = [
  'albums',
  'artists',
  'tracks',
  'songs',
  'playlists',
] as const satisfies readonly (keyof typeof COUNTS_COPY)[]

type CountName = (typeof COUNT_ORDER)[number]

type CountsLineOfProps = Partial<Record<CountName, number>>

type CountOfProps = { name: CountName; n: number }

/** One count in words, or null for none: "1 album", "4,812 songs". */
const countOf = ({ name, n }: CountOfProps): string | null =>
  n > 0 ? plural({ n, ...COUNTS_COPY[name] }) : null

/**
 * What an artist or a collection holds, on one line, every zero dropped: "7 albums · 114
 * tracks", "1 track", or nothing at all.
 */
export const countsLineOf = (counts: CountsLineOfProps): string =>
  factsLineOf(COUNT_ORDER.map((name) => countOf({ name, n: counts[name] ?? 0 })))

type LineValueOfProps = {
  /** What it holds as a line, or null while that is on its way or could not be read. */
  line: string | null
  none: string
}

/** One of Home's shortcuts' value: what it holds, what none reads as, or nothing while it is not known. */
export const lineValueOf = ({ line, none }: LineValueOfProps): string | undefined => {
  if (line === null) return undefined
  return line === '' ? none : line
}

type CountValueOfProps = {
  /** The count, or null while it is on its way or could not be read. */
  n: number | null
  /** What none reads as, when it is worth saying; left out otherwise. */
  none?: string
  /** The most its list shows, past which the count reads as that many and more: "48+". */
  most?: number
}

/** One of Library's categories' value: its count, "None yet" where that says something, or nothing at all. */
export const countValueOf = ({ n, none, most }: CountValueOfProps): string | undefined => {
  if (n === null) return undefined
  if (n === 0) return none
  if (most !== undefined && n > most) return COUNTS_COPY.orMore(formatCount(most))
  return formatCount(n)
}
