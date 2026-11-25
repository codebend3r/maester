import { DEFAULT_SHELF_ORDER, type Library, SHELF_ORDERS, type ShelfOrder } from '@/contract'

/** Anything that stands for a library's row: it names the library it is for. */
type LibraryRow = { libraryId: number }

type WithLibrariesProps<S extends LibraryRow> = {
  shelves: readonly S[]
  libraries: readonly Library[]
}

/** Each shelf with the library it is for; a shelf for a library not in the list is left out. */
export const withLibraries = <S extends LibraryRow>({
  shelves,
  libraries,
}: WithLibrariesProps<S>): Array<{ shelf: S; library: Library }> =>
  shelves.flatMap((shelf) => {
    const library = libraries.find(({ id }) => id === shelf.libraryId)
    return library === undefined ? [] : [{ shelf, library }]
  })

/** The order each library's shelf on Home was turned to, by library id; a library not in it is in `DEFAULT_SHELF_ORDER`. */
export type ShelfOrders = Readonly<Partial<Record<number, ShelfOrder>>>

/** What each shelf order is called, on its toggle and wherever it is said. */
export const SHELF_ORDER_COPY = {
  [SHELF_ORDERS.added]: 'Recently added',
  [SHELF_ORDERS.released]: 'Newly released',
} as const satisfies Record<ShelfOrder, string>

const OTHER_ORDERS = {
  [SHELF_ORDERS.added]: SHELF_ORDERS.released,
  [SHELF_ORDERS.released]: SHELF_ORDERS.added,
} as const satisfies Record<ShelfOrder, ShelfOrder>

/** The order a shelf's toggle turns it to. */
export const otherShelfOrder = (order: ShelfOrder): ShelfOrder => OTHER_ORDERS[order]

type ShelfOrderOfProps = { orders: ShelfOrders; libraryId: number }

/** The order a library's shelf is in: the one it was turned to, else the default. */
export const shelfOrderOf = ({ orders, libraryId }: ShelfOrderOfProps): ShelfOrder =>
  orders[libraryId] ?? DEFAULT_SHELF_ORDER

/** The orders once a library's shelf is turned to the other order. */
export const turnedShelfOrders = ({ orders, libraryId }: ShelfOrderOfProps): ShelfOrders => ({
  ...orders,
  [libraryId]: otherShelfOrder(shelfOrderOf({ orders, libraryId })),
})

/** Whether any shelf is turned away from the default, so the other order's shelves need reading. */
export const isAnyShelfReleased = (orders: ShelfOrders): boolean =>
  Object.values(orders).some((order) => order === SHELF_ORDERS.released)

type ShelfToggleLabelProps = { name: string; order: ShelfOrder }

/** The words a shelf's toggle is said aloud in: the order the shelf is in, and the one a press shows. */
export const SHELF_TOGGLE_COPY = {
  label: ({ name, order }: ShelfToggleLabelProps) =>
    `${name}: ${SHELF_ORDER_COPY[order]}. Show ${SHELF_ORDER_COPY[otherShelfOrder(order)].toLowerCase()}`,
} as const

type ShelvesInOrderProps<S extends LibraryRow> = {
  /** Every shelf in the default order, which sets which shelves there are and their order. */
  shelves: readonly S[]
  /** The shelves in the other order, once read; null until then. */
  released: readonly S[] | null
  orders: ShelfOrders
}

/**
 * Each shelf in the order its library's toggle is turned to: a shelf turned to Newly released
 * takes the released list's shelf for its library, and keeps its own until that list is read.
 */
export const shelvesInOrder = <S extends LibraryRow>({
  shelves,
  released,
  orders,
}: ShelvesInOrderProps<S>): S[] =>
  shelves.map((shelf) => {
    if (shelfOrderOf({ orders, libraryId: shelf.libraryId }) !== SHELF_ORDERS.released) return shelf
    return released?.find(({ libraryId }) => libraryId === shelf.libraryId) ?? shelf
  })
