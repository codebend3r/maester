const COUNT = new Intl.NumberFormat()

/** A bare count, grouped as the listener reads numbers: "1,980". */
export const countText = (n: number): string => COUNT.format(n)
