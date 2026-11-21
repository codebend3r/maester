type OneOfOrProps<T> = {
  /** Every value it knows. */
  values: readonly T[]
  /** What it answers for anything else. */
  fallback: T
}

/**
 * A reader for a value from outside, such as a path's segment: the value itself when it is one
 * of `values`, else `fallback`. It is the guard at that boundary.
 */
export const oneOfOr = <T>({ values, fallback }: OneOfOrProps<T>) => {
  const isKnown = (value: unknown): value is T => values.some((known) => known === value)
  return (value: unknown): T => (isKnown(value) ? value : fallback)
}
