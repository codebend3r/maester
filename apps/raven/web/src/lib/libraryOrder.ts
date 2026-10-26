type MoveIdProps = {
  ids: readonly number[]
  id: number
  to: number
}

/**
 * `ids` with `id` moved to index `to`, the others closing up around it. The
 * very same list where `id` is not there or is already at `to`.
 */
export const moveId = ({ ids, id, to }: MoveIdProps): readonly number[] => {
  const from = ids.indexOf(id)
  const target = Math.min(Math.max(to, 0), ids.length - 1)
  if (from === -1 || from === target) return ids
  const rest = ids.filter((each) => each !== id)
  return [...rest.slice(0, target), id, ...rest.slice(target)]
}

type SameOrderProps = { a: readonly number[]; b: readonly number[] }

/** Whether `a` and `b` list the same ids in the same places. */
export const sameOrder = ({ a, b }: SameOrderProps): boolean =>
  a.length === b.length && a.every((id, index) => id === b[index])
