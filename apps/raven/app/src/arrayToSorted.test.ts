import { describe, expect, it } from 'bun:test'

import { TO_SORTED, installToSorted } from '@/arrayToSorted'

/** What the polyfill put on `target`, called on `list`. */
const sortedBy = ({
  target,
  list,
  compare,
}: {
  target: object
  list: number[]
  compare?: (a: number, b: number) => number
}): unknown => {
  const toSorted: unknown = Reflect.get(target, TO_SORTED)
  if (typeof toSorted !== 'function') throw new Error('No toSorted')
  return Reflect.apply(toSorted, list, [compare])
}

describe('installToSorted', () => {
  it('adds a toSorted that sorts a copy, as the language has it, where the engine lacks one', () => {
    const target = {}
    installToSorted({ prototype: target })
    const list = [3, 10, 1]
    expect(sortedBy({ target, list })).toEqual([1, 10, 3])
    expect(sortedBy({ target, list, compare: (a, b) => a - b })).toEqual([1, 3, 10])
    expect(list).toEqual([3, 10, 1])
  })

  it('keeps the engine its own toSorted', () => {
    const own = () => []
    const target = { toSorted: own }
    installToSorted({ prototype: target })
    expect(target.toSorted).toBe(own)
  })
})
