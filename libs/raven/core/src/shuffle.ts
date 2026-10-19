/**
 * How many videos a shuffle lines up, the one it starts with among them, so
 * the queue riding along with each video stays small however big the library.
 */
export const SHUFFLE_LENGTH = 50

/**
 * `items` in a random order, every order as likely as the next: each item
 * drops in at a random place among those dealt before it. `roll` is the die,
 * 0 up to 1, so a test can load it.
 */
export const shuffled = <T>({
  items,
  roll = Math.random,
}: {
  items: readonly T[]
  roll?: () => number
}): T[] =>
  items.reduce<T[]>(
    (dealt, item, index) => dealt.toSpliced(Math.floor(roll() * (index + 1)), 0, item),
    [],
  )
