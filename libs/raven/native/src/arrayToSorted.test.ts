import { describe, expect, it } from 'bun:test'

import { TO_SORTED, installToSorted } from '@/arrayToSorted'

type SortedByProps = {
  target: object
  list: number[]
  compare?: (a: number, b: number) => number
}

/** What the polyfill put on `target`, called on `list`. */
const sortedBy = ({ target, list, compare }: SortedByProps): unknown => {
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

describe('the installed toSorted', () => {
  const target = {}
  installToSorted({ prototype: target })
  const toSorted: unknown = Reflect.get(target, TO_SORTED)

  it('is named as the language names it', () => {
    expect(typeof toSorted === 'function' && toSorted.name).toBe(TO_SORTED)
  })

  it('keeps equal items in the order they came', () => {
    if (typeof toSorted !== 'function') throw new Error('No toSorted')
    const pairs = [
      { rank: 2, name: 'first two' },
      { rank: 1, name: 'one' },
      { rank: 2, name: 'second two' },
    ]
    type SortedCallbackProps = { rank: number }

    const sorted: unknown = Reflect.apply(toSorted, pairs, [
      (a: SortedCallbackProps, b: SortedCallbackProps) => a.rank - b.rank,
    ])
    expect(sorted).toEqual([pairs[1], pairs[0], pairs[2]])
  })

  it('reads a hole as undefined and sorts it last, as the language does', () => {
    if (typeof toSorted !== 'function') throw new Error('No toSorted')
    // oxlint-disable-next-line no-sparse-arrays -- the hole is what is under test
    const sparse = [3, , 1]
    const sorted: unknown = Reflect.apply(toSorted, sparse, [])
    expect(sorted).toEqual([1, 3, undefined])
    expect(Array.isArray(sorted) && 1 in sorted && 2 in sorted).toBe(true)
  })
})
