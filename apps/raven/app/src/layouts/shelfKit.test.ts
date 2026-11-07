import { describe, expect, it } from 'bun:test'

import type { BingeCard } from '@/queries/bingeCards'
import { CARD_SHAPES } from '@/queries/cards'
import { ROUTE_TARGETS } from '@/routes'
import { bingeRowsOf } from '@/layouts/shelfKit'

const binge = (key: string): BingeCard => ({
  key,
  title: key,
  line: null,
  shape: CARD_SHAPES.wide,
  picture: null,
  progress: 0,
  target: { kind: ROUTE_TARGETS.play, mediaId: 1, at: 0 },
  meta: null,
  episodeLine: null,
  stars: null,
  synopsis: null,
  status: null,
  page: { kind: ROUTE_TARGETS.play, mediaId: 1, at: 0 },
})

const keysOf = (rows: ReturnType<typeof bingeRowsOf>) =>
  rows.map((row) => row.map(({ key }) => key))

describe('bingeRowsOf', () => {
  it('draws nothing for no shows', () => {
    expect(bingeRowsOf([])).toEqual([])
  })

  it('puts one show across the width', () => {
    expect(keysOf(bingeRowsOf([binge('a')]))).toEqual([['a']])
  })

  it('stacks two shows, each across the width', () => {
    expect(keysOf(bingeRowsOf([binge('a'), binge('b')]))).toEqual([['a'], ['b']])
  })

  it('keeps the first across the width and puts the other two side by side', () => {
    expect(keysOf(bingeRowsOf([binge('a'), binge('b'), binge('c')]))).toEqual([['a'], ['b', 'c']])
  })
})
