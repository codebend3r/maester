type GroupByProps<T> = {
  items: readonly T[]
  key: (item: T) => string
}

/** `items` bucketed by `key`, each bucket in the order its items came. */
export const groupBy = <T>({ items, key }: GroupByProps<T>): Map<string, T[]> =>
  items.reduce((groups, item) => {
    const k = key(item)
    return groups.set(k, [...(groups.get(k) ?? []), item])
  }, new Map<string, T[]>())
