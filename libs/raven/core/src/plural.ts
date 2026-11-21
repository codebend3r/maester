const count = new Intl.NumberFormat()

/** A bare count, grouped as the reader's locale groups numbers: "1,980". */
export const formatCount = (n: number): string => count.format(n)

type PluralProps = { n: number; one: string; many: string }

/** "1 file", "2 files", "1,204 videos": a count and the word for that many. */
export const plural = ({ n, one, many }: PluralProps): string =>
  `${formatCount(n)} ${n === 1 ? one : many}`
