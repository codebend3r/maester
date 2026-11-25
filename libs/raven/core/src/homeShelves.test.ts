import { describe, expect, it } from 'bun:test'
import { HOME_SHELF_TYPES, type HomeShelf, SHELF_ORDERS } from '@/contract'
import {
  isAnyShelfReleased,
  otherShelfOrder,
  SHELF_TOGGLE_COPY,
  shelfOrderOf,
  shelvesInOrder,
  turnedShelfOrders,
  withLibraries,
} from '@/homeShelves'
import { library } from '@/test/fixtures'

const shelfFor = (libraryId: number): HomeShelf => ({
  libraryId,
  type: HOME_SHELF_TYPES.media,
  media: [],
})

describe('withLibraries', () => {
  it("pairs each shelf with its library, in the shelves' own order", () => {
    const films = library({ id: 1, name: 'Films' })
    const series = library({ id: 2, name: 'Series' })
    const shelves = [shelfFor(2), shelfFor(1)]
    expect(withLibraries({ shelves, libraries: [films, series] })).toEqual([
      { shelf: shelves[0], library: series },
      { shelf: shelves[1], library: films },
    ])
  })

  it('leaves out a shelf for a library the list does not hold, as a locked one', () => {
    const films = library({ id: 1, name: 'Films' })
    const shelves = [shelfFor(9), shelfFor(1)]
    expect(withLibraries({ shelves, libraries: [films] })).toEqual([
      { shelf: shelves[1], library: films },
    ])
    expect(withLibraries({ shelves, libraries: [] })).toEqual([])
  })
})

describe('shelf orders', () => {
  it('reads a library left alone as recently added, and one turned as it was turned', () => {
    const orders = { 2: SHELF_ORDERS.released }
    expect(shelfOrderOf({ orders, libraryId: 1 })).toBe(SHELF_ORDERS.added)
    expect(shelfOrderOf({ orders, libraryId: 2 })).toBe(SHELF_ORDERS.released)
  })

  it("turns one library's shelf, leaving the others as they were", () => {
    const orders = turnedShelfOrders({ orders: { 1: SHELF_ORDERS.released }, libraryId: 2 })
    expect(orders).toEqual({ 1: SHELF_ORDERS.released, 2: SHELF_ORDERS.released })
    expect(turnedShelfOrders({ orders, libraryId: 1 })).toEqual({
      1: SHELF_ORDERS.added,
      2: SHELF_ORDERS.released,
    })
  })

  it('turns each order into the other', () => {
    expect(otherShelfOrder(SHELF_ORDERS.added)).toBe(SHELF_ORDERS.released)
    expect(otherShelfOrder(SHELF_ORDERS.released)).toBe(SHELF_ORDERS.added)
  })

  it('needs the released shelves only once a shelf is turned to them', () => {
    expect(isAnyShelfReleased({})).toBe(false)
    expect(isAnyShelfReleased({ 1: SHELF_ORDERS.added })).toBe(false)
    expect(isAnyShelfReleased({ 1: SHELF_ORDERS.released })).toBe(true)
  })

  it('says the order a shelf is in and the one a press turns it to', () => {
    expect(SHELF_TOGGLE_COPY.label({ name: 'Films', order: SHELF_ORDERS.added })).toBe(
      'Films: Recently added. Show newly released',
    )
  })

  it("puts a turned shelf's released row in its place, keeping its own until they are read", () => {
    const added = [shelfFor(1), shelfFor(2)]
    const released = [shelfFor(1), shelfFor(2)]
    const orders = { 2: SHELF_ORDERS.released }
    const inOrder = shelvesInOrder({ shelves: added, released, orders })
    expect(inOrder[0]).toBe(added[0])
    expect(inOrder[1]).toBe(released[1])
    expect(shelvesInOrder({ shelves: added, released: null, orders })[1]).toBe(added[1])
  })
})
