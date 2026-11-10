/** What the handle and the screen reader's moves are called. */
export const SORTABLE_COPY = {
  /** The handle that drags a row to another place in the line. */
  reorder: 'Reorder',
  moveUp: 'Move up',
  moveDown: 'Move down',
} as const

/** Where a dragged row may land: the rows before `pinnedCount` stay put, and only `movableCount` after them move. */
type DropIndexOfProps = {
  /** The index the row was lifted from. */
  from: number
  /** How far the finger has moved it, in points, down being positive. */
  dy: number
  /** One row's pitch: its height and the gap after it. */
  rowHeight: number
  pinnedCount: number
  movableCount: number
}

/** The index a lifted row would land at, held inside the rows that may move. */
export const dropIndexOf = ({
  from,
  dy,
  rowHeight,
  pinnedCount,
  movableCount,
}: DropIndexOfProps): number => {
  if (movableCount <= 0 || rowHeight <= 0) return from
  const last = pinnedCount + movableCount - 1
  const wanted = from + Math.round(dy / rowHeight)
  return Math.min(last, Math.max(pinnedCount, wanted))
}

type LandingBeforeOfProps = { keys: readonly string[]; from: number; to: number }

/**
 * The key a row moved from `from` to `to` lands before, as the store takes it, or null for the
 * end of the list: moving down, the row after the slot, since the row itself leaves its place.
 */
export const landingBeforeOf = ({ keys, from, to }: LandingBeforeOfProps): string | null =>
  (to > from ? keys[to + 1] : keys[to]) ?? null

type ShiftOfProps = { index: number; from: number; to: number; rowHeight: number }

/** How far a row not being dragged parts to show the slot: up when the slot passed it going down, else down. */
export const shiftOf = ({ index, from, to, rowHeight }: ShiftOfProps): number => {
  if (index === from) return 0
  if (from < index && index <= to) return -rowHeight
  if (to <= index && index < from) return rowHeight
  return 0
}

type IsMovableAtProps = { index: number; pinnedCount: number; movableCount: number }

/** Whether the row at `index` may be dragged and landed on: past the pinned rows, inside the movable ones. */
export const isMovableAt = ({ index, pinnedCount, movableCount }: IsMovableAtProps): boolean =>
  index >= pinnedCount && index < pinnedCount + movableCount

/** The ways the screen reader moves a row, one place at a time. */
export const MOVE_STEPS = { up: -1, down: 1 } as const

export type MoveStep = (typeof MOVE_STEPS)[keyof typeof MOVE_STEPS]

type StepMoveOfProps = {
  keys: readonly string[]
  index: number
  step: MoveStep
  pinnedCount: number
  movableCount: number
}

export type RowMove = { key: string; before: string | null }

/** The move a step up or down from `index` makes; null at the end of the movable rows. */
export const stepMoveOf = ({
  keys,
  index,
  step,
  pinnedCount,
  movableCount,
}: StepMoveOfProps): RowMove | null => {
  const key = keys[index]
  const to = index + step
  if (key === undefined || !isMovableAt({ index: to, pinnedCount, movableCount })) return null
  return { key, before: landingBeforeOf({ keys, from: index, to }) }
}
