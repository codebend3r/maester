import { type ShelfOrders, isRecord, isShelfOrder, turnedShelfOrders } from '@raven/core'
import { create } from 'zustand'
import { STORE_KEYS, keptInStorage } from '@/stores/storage'

type TurnProps = { libraryId: number }

type ShelfOrdersState = {
  orders: ShelfOrders
  /** Turns a library's shelf on Home to its other order. */
  turn: (props: TurnProps) => void
}

/** The orders read back from localStorage, each library's kept only where it is an order. */
const restoredOrders = (saved: unknown): Pick<ShelfOrdersState, 'orders'> => {
  if (!isRecord(saved) || !isRecord(saved.orders)) return { orders: {} }
  const orders = Object.entries(saved.orders).reduce<ShelfOrders>(
    (kept, [libraryId, order]) =>
      isShelfOrder(order) ? { ...kept, [Number(libraryId)]: order } : kept,
    {},
  )
  return { orders }
}

/** The order each library's shelf on Home is turned to, kept on this browser across visits. */
export const useShelfOrders = create<ShelfOrdersState>()(
  keptInStorage({
    key: STORE_KEYS.shelfOrders,
    name: 'raven/shelfOrders',
    state: (set) => ({
      orders: {},
      turn: ({ libraryId }) =>
        set(({ orders }) => ({ orders: turnedShelfOrders({ orders, libraryId }) })),
    }),
    keep: ({ orders }) => ({ orders }),
    restore: restoredOrders,
  }),
)
