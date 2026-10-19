const count = new Intl.NumberFormat()

/** "1 file", "2 files", "1,204 videos": a count and the word for that many. */
export const plural = ({ n, one, many }: { n: number; one: string; many: string }): string =>
  `${count.format(n)} ${n === 1 ? one : many}`
