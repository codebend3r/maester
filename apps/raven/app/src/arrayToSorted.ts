/** The name of the language's `Array.prototype.toSorted`. */
export const TO_SORTED = 'toSorted'

/**
 * `toSorted` as ES2023 has it: the array's items in a new array, sorted stably, holes read as
 * `undefined` and put last, the array untouched. Named as the language names it.
 */
function toSorted<T>(this: readonly T[], compare?: (a: T, b: T) => number): T[] {
  return [...this].sort(compare)
}

/**
 * Gives `prototype` the language's `toSorted` where the engine has none. React Native
 * 0.88's Hermes has `toReversed`, `toSpliced` and `with` but not `toSorted`, which
 * `@raven/core` sorts with (the grouped view's buckets, the stream qualities, the media
 * origins), so `src/polyfills.ts` installs it on `Array.prototype` before anything loads
 * core.
 */
export const installToSorted = ({ prototype }: { prototype: object }): void => {
  if (TO_SORTED in prototype) return
  Object.defineProperty(prototype, TO_SORTED, {
    value: toSorted,
    writable: true,
    configurable: true,
  })
}
