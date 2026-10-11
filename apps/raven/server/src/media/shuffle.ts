/**
 * mulberry32: a small seeded generator, so a seed always deals the same
 * sequence. Not for anything that needs to be unguessable.
 */
const generator = (seed: number): (() => number) => {
  const state = { value: seed >>> 0 }
  return () => {
    state.value = (state.value + 0x6d2b79f5) >>> 0
    const mixed = Math.imul(state.value ^ (state.value >>> 15), 1 | state.value)
    const spread = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed
    return ((spread ^ (spread >>> 14)) >>> 0) / 4_294_967_296
  }
}

/** The items in an order fixed by `seed`: the same seed and items always give the same order. */
export const shuffle = <T>({ items, seed }: { items: readonly T[]; seed: number }): T[] => {
  const next = generator(seed)
  return items
    .map((item) => ({ item, rank: next() }))
    .toSorted((a, b) => a.rank - b.rank)
    .map(({ item }) => item)
}
