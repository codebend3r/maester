import { Icon } from '@raven/native'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import {
  type AccessibilityActionEvent,
  Animated,
  type GestureResponderEvent,
  StyleSheet,
  View,
} from 'react-native'

import {
  MOVE_STEPS,
  type MoveStep,
  type RowMove,
  SORTABLE_COPY,
  dropIndexOf,
  isMovableAt,
  landingBeforeOf,
  shiftOf,
  stepMoveOf,
} from '@/layouts/sortableKit'
import { useReduceMotion } from '@/stores/reduceMotion'
import { SIZES } from '@/theme/appTheme'
import { themedStyles, useTheme } from '@/theme/useTheme'
import { APP_ICONS } from '@/theme/icons'

/** How long a finger rests on the handle before the row lifts. */
const LIFT_MS = 350

/** How much a lifted row grows, when motion is allowed. */
const LIFT_SCALE = 1.02

/** How long the other rows take to part for the slot, when motion is allowed. */
const SHIFT_MS = 150

const SHADOW = { opacity: 0.25, offset: 4, radius: 12 } as const

/** The handle's test id, numbered by its row. */
const SORTABLE_TEST_ID = 'sortable-handle'

/** The screen reader's moves, by name, each a step up or down. */
const MOVE_ACTION_NAMES = { moveUp: 'moveUp', moveDown: 'moveDown' } as const

type MoveActionName = (typeof MOVE_ACTION_NAMES)[keyof typeof MOVE_ACTION_NAMES]

const MOVE_ACTIONS = [
  { name: MOVE_ACTION_NAMES.moveUp, label: SORTABLE_COPY.moveUp },
  { name: MOVE_ACTION_NAMES.moveDown, label: SORTABLE_COPY.moveDown },
] as const

const STEP_OF_ACTION = {
  [MOVE_ACTION_NAMES.moveUp]: MOVE_STEPS.up,
  [MOVE_ACTION_NAMES.moveDown]: MOVE_STEPS.down,
} as const satisfies Record<MoveActionName, MoveStep>

const isMoveActionName = (value: string): value is MoveActionName =>
  Object.values(MOVE_ACTION_NAMES).some((name) => name === value)

/** The row being dragged: where it was lifted from and where it would land now. */
type Drag = { from: number; to: number }

type DragHandlers = {
  onLift: () => void
  onDrag: (dy: number) => void
  onDrop: () => void
}

type SortableRowProps = {
  index: number
  /** May be dragged: has a handle. */
  isMovable: boolean
  isLifted: boolean
  /** How far the row has parted for the slot, when it is not the one lifted. */
  shift: number
  /** How far the lifted row has been dragged. */
  dy: Animated.Value
  height: number
  handlers: DragHandlers
  onStep: (step: MoveStep) => void
  children: ReactNode
}

/**
 * One row of the list. A long press on its handle lifts it; a drag then moves it with the
 * finger, and letting go drops it. The handle also carries the screen reader's Move up and
 * Move down, since VoiceOver cannot drag.
 */
const SortableRow = ({
  index,
  isMovable,
  isLifted,
  shift,
  dy,
  height,
  handlers,
  onStep,
  children,
}: SortableRowProps) => {
  const styles = useStyles()
  const text = useTheme((theme) => theme.palette.text)
  const isReduced = useReduceMotion((motion) => motion.isReduced)
  const [shiftValue] = useState(() => new Animated.Value(0))
  const liftTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Where the finger came down, so each move is measured from it.
  const startY = useRef(0)

  useEffect(() => {
    Animated.timing(shiftValue, {
      toValue: shift,
      duration: isReduced ? 0 : SHIFT_MS,
      useNativeDriver: true,
    }).start()
  }, [shift, isReduced, shiftValue])

  const onGrant = ({ nativeEvent }: GestureResponderEvent) => {
    startY.current = nativeEvent.pageY
    liftTimer.current = setTimeout(handlers.onLift, LIFT_MS)
  }
  const onMove = ({ nativeEvent }: GestureResponderEvent) => {
    if (isLifted) handlers.onDrag(nativeEvent.pageY - startY.current)
  }
  const onEnd = () => {
    if (liftTimer.current !== null) clearTimeout(liftTimer.current)
    liftTimer.current = null
    if (isLifted) handlers.onDrop()
  }
  // Until the row lifts, a scroll may take the touch; lifted, the row keeps it.
  const mayScroll = () => !isLifted

  const onAccessibilityAction = ({ nativeEvent }: AccessibilityActionEvent) => {
    if (isMoveActionName(nativeEvent.actionName)) onStep(STEP_OF_ACTION[nativeEvent.actionName])
  }

  const liftedStyle = isReduced ? styles.liftedStill : styles.liftedMoving
  const liftScale = isReduced ? 1 : LIFT_SCALE
  const transform = isLifted
    ? [{ translateY: dy }, { scale: liftScale }]
    : [{ translateY: shiftValue }]
  return (
    <Animated.View style={[styles.row, { height }, isLifted && liftedStyle, { transform }]}>
      <View style={styles.content}>{children}</View>
      {isMovable && (
        <View
          accessible
          accessibilityActions={MOVE_ACTIONS}
          accessibilityLabel={SORTABLE_COPY.reorder}
          accessibilityRole="button"
          hitSlop={SIZES.space1}
          onAccessibilityAction={onAccessibilityAction}
          onResponderGrant={onGrant}
          onResponderMove={onMove}
          onResponderRelease={onEnd}
          onResponderTerminate={onEnd}
          onResponderTerminationRequest={mayScroll}
          onStartShouldSetResponder={() => true}
          style={styles.handle}
          testID={`${SORTABLE_TEST_ID}-${index}`}
        >
          <Icon colour={text} name={APP_ICONS.grip} size={SIZES.textLg} />
        </View>
      )}
    </Animated.View>
  )
}

type StepProps = { index: number; step: MoveStep }

export type SortableListProps<T> = {
  rows: readonly T[]
  keyOf: (row: T) => string
  renderRow: (row: T) => ReactNode
  /** The first rows, which have no handle and above which nothing lands. */
  pinnedCount: number
  /** How many rows after the pinned ones may be dragged and landed among; the rest stay put. */
  movableCount: number
  /** Every row's height, the same for all, so a drag's slot is read off the distance. */
  rowHeight: number
  /** The gap between rows. */
  gap: number
  onMove: (move: RowMove) => void
  /** Hears a row lift and drop, so the page stops scrolling under the drag. */
  onDragChange: (isDragging: boolean) => void
}

/**
 * Rows of one height that a finger reorders: a long press on a row's handle lifts it, the
 * drag moves it, the rows beneath part to show where it would land, and letting go tells
 * `onMove` the key it lands before, or null for the end. The pinned rows at the top stay put.
 * The responder flushes each touch's state before the next arrives, so the handlers, made
 * afresh each render, always read the drag as it stands.
 */
export const SortableList = <T,>({
  rows,
  keyOf,
  renderRow,
  pinnedCount,
  movableCount,
  rowHeight,
  gap,
  onMove,
  onDragChange,
}: SortableListProps<T>) => {
  const [drag, setDrag] = useState<Drag | null>(null)
  const [dy] = useState(() => new Animated.Value(0))
  const keys = rows.map(keyOf)
  const pitch = rowHeight + gap
  const handlersOf = (from: number): DragHandlers => ({
    onLift: () => {
      dy.setValue(0)
      setDrag({ from, to: from })
      onDragChange(true)
    },
    onDrag: (distance) => {
      dy.setValue(distance)
      const to = dropIndexOf({ from, dy: distance, rowHeight: pitch, pinnedCount, movableCount })
      setDrag((current) => (current === null || current.to === to ? current : { ...current, to }))
    },
    onDrop: () => {
      setDrag(null)
      dy.setValue(0)
      onDragChange(false)
      if (drag === null || drag.to === drag.from) return
      const key = keys[drag.from]
      if (key === undefined) return
      onMove({ key, before: landingBeforeOf({ keys, from: drag.from, to: drag.to }) })
    },
  })
  const onStep = ({ index, step }: StepProps) => {
    const move = stepMoveOf({ keys, index, step, pinnedCount, movableCount })
    if (move !== null) onMove(move)
  }
  return (
    <View style={{ gap }}>
      {rows.map((row, index) => (
        <SortableRow
          key={keys[index]}
          dy={dy}
          handlers={handlersOf(index)}
          height={rowHeight}
          index={index}
          isLifted={(drag?.from ?? null) === index}
          isMovable={isMovableAt({ index, pinnedCount, movableCount })}
          onStep={(step) => onStep({ index, step })}
          shift={
            drag === null ? 0 : shiftOf({ index, from: drag.from, to: drag.to, rowHeight: pitch })
          }
        >
          {renderRow(row)}
        </SortableRow>
      ))}
    </View>
  )
}

const useStyles = themedStyles((colours) =>
  StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', borderRadius: SIZES.radius },
    content: { flex: 1, height: '100%' },
    handle: {
      minWidth: SIZES.fieldHeight,
      height: '100%',
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: SIZES.radius,
    },
    liftedMoving: {
      zIndex: 1,
      backgroundColor: colours.ground,
      shadowColor: colours.ground,
      shadowOpacity: SHADOW.opacity,
      shadowRadius: SHADOW.radius,
      shadowOffset: { width: 0, height: SHADOW.offset },
      elevation: SHADOW.offset,
    },
    liftedStill: {
      zIndex: 1,
      backgroundColor: colours.ground,
      borderWidth: SIZES.focusRing,
      borderColor: colours.accent,
    },
  }),
)
