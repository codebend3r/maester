const count = new Intl.NumberFormat()

type PluralProps = { n: number; one: string; many: string }

/** "1 file", "2 files", "1,204 videos": a count and the word for that many. */
export const plural = ({ n, one, many }: PluralProps): string =>
  `${count.format(n)} ${n === 1 ? one : many}`
