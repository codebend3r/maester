import { afterEach, describe, expect, it } from 'bun:test'
import { SHELF_ORDERS } from '@raven/core'
import { useShelfOrders } from '@/stores/shelfOrders'
import { STORE_KEYS } from '@/stores/storage'

afterEach(() => {
  window.localStorage.clear()
  useShelfOrders.setState({ orders: {} })
})

describe('useShelfOrders', () => {
  it('turns a shelf and back, keeping the choice on this browser', () => {
    useShelfOrders.getState().turn({ libraryId: 2 })
    expect(useShelfOrders.getState().orders).toEqual({ 2: SHELF_ORDERS.released })
    expect(window.localStorage.getItem(STORE_KEYS.shelfOrders)).toContain('released')
    useShelfOrders.getState().turn({ libraryId: 2 })
    expect(useShelfOrders.getState().orders).toEqual({ 2: SHELF_ORDERS.added })
  })

  it('reads back only the orders it can use', async () => {
    window.localStorage.setItem(
      STORE_KEYS.shelfOrders,
      JSON.stringify({ state: { orders: { 2: 'released', 3: 'sideways' } }, version: 0 }),
    )
    await useShelfOrders.persist.rehydrate()
    expect(useShelfOrders.getState().orders).toEqual({ 2: SHELF_ORDERS.released })
  })
})
