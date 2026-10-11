/** `items` bucketed by `key`, each bucket in the order its items came. */
export const groupBy = <T>({
  items,
  key,
}: {
  items: readonly T[]
  key: (item: T) => string
}): Map<string, T[]> =>
  items.reduce((groups, item) => {
    const k = key(item)
    return groups.set(k, [...(groups.get(k) ?? []), item])
  }, new Map<string, T[]>())
