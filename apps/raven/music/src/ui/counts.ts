import { plural } from '@raven/core'

import { COUNTS_COPY, KIT_COPY } from '@/ui/copy'

/** Facts on one line, each one missing or empty left out: "Pop · 2014 · 20 songs". */
export const factsLineOf = (facts: readonly (string | null)[]): string =>
  KIT_COPY.facts(facts.filter((fact): fact is string => fact !== null && fact !== ''))

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
