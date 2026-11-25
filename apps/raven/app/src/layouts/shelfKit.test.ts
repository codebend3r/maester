import { describe, expect, it } from 'bun:test'

import type { BingeCard } from '@/queries/bingeCards'
import { CARD_SHAPES } from '@/queries/cards'
import { ROUTE_TARGETS } from '@/routes'
import { SHELF_ORDERS } from '@raven/core'
import { SHELF_LAYOUTS, type ShelfView } from '@/queries/homeShelves'
import { bingeRowsOf, shelfOrderToggleOf } from '@/layouts/shelfKit'

const binge = (key: string): BingeCard => ({
  key,
  title: key,
  line: null,
  shape: CARD_SHAPES.wide,
  picture: null,
  progress: 0,
  subject: null,
  isWatched: false,
  target: { kind: ROUTE_TARGETS.play, mediaId: 1, at: 0 },
  meta: null,
  episodeLine: null,
  stars: null,
  synopsis: null,
  status: null,
  page: { kind: ROUTE_TARGETS.play, mediaId: 1, at: 0 },
  poster: null,
  rowStatus: null,
  playLabel: null,
  seen: null,
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

const shelfView = (overrides: Partial<ShelfView>): ShelfView => ({
  key: 'library:2',
  title: 'Films',
  libraryId: 2,
  cards: [],
  layout: SHELF_LAYOUTS.row,
  hasMore: false,
  order: SHELF_ORDERS.added,
  ...overrides,
})

describe('shelfOrderToggleOf', () => {
  it('shows the order a library shelf is in, says the one a press turns it to, and turns it', () => {
    const turned: number[] = []
    const toggle = shelfOrderToggleOf({
      shelf: shelfView({}),
      onTurnOrder: (libraryId) => turned.push(libraryId),
    })
    expect(toggle).toMatchObject({
      icon: 'plus',
      text: 'Recently added',
      label: 'Films: Recently added. Show newly released',
    })
    toggle?.onTurn()
    expect(turned).toEqual([2])
    expect(
      shelfOrderToggleOf({
        shelf: shelfView({ order: SHELF_ORDERS.released }),
        onTurnOrder: () => undefined,
      }),
    ).toMatchObject({ icon: 'calendar', text: 'Newly released' })
  })

  it('gives no toggle to a shelf with no order, or with nothing to turn it', () => {
    expect(
      shelfOrderToggleOf({ shelf: shelfView({ order: null }), onTurnOrder: () => undefined }),
    ).toBeNull()
    expect(shelfOrderToggleOf({ shelf: shelfView({}) })).toBeNull()
  })
})
