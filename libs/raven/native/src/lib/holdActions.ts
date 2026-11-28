import type { AccessibilityActionEvent, AccessibilityActionInfo, ViewProps } from 'react-native'

/** The screen reader's standard action a long press is offered as. */
const ACCESSIBILITY_ACTIONS = { longPress: 'longpress' } as const

/** What of the screen reader's action event a hold reads: the action's name. */
type HoldActionEvent = { nativeEvent: Pick<AccessibilityActionEvent['nativeEvent'], 'actionName'> }

/** What an element offering a long press wears for the screen reader. */
type HoldActionProps = Pick<ViewProps, 'accessibilityActions' | 'accessibilityHint'> & {
  onAccessibilityAction?: (event: HoldActionEvent) => void
}

type HoldActionPropsOfProps = {
  /** The action's name in the screen reader's list; without one, iOS reads out the raw `longpress`. */
  label: string
  /** What the screen reader says the long press does, in the app's own words. */
  hint: string
  /** What the long press does; undefined for an element with nothing to hold. */
  onHold: (() => void) | undefined
}

/**
 * A long press as the screen reader's action, for the element it reads out: the control itself,
 * or one that speaks for a smaller one the finger holds (a tile for its cover). Only the long
 * press action holds; nothing, for an element with nothing to hold.
 */
export const holdActionPropsOf = ({
  label,
  hint,
  onHold,
}: HoldActionPropsOfProps): HoldActionProps => {
  if (onHold === undefined) return {}
  const actions: AccessibilityActionInfo[] = [{ name: ACCESSIBILITY_ACTIONS.longPress, label }]
  return {
    accessibilityActions: actions,
    accessibilityHint: hint,
    onAccessibilityAction: ({ nativeEvent }) => {
      if (nativeEvent.actionName === ACCESSIBILITY_ACTIONS.longPress) onHold()
    },
  }
}
