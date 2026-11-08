import type { ViewStyle } from 'react-native'

/**
 * What the remote's focus wears over its neighbours: the focused view stands in front of every
 * sibling, so a card grown by focus, or a ring drawn past its edge, is never cut by the one
 * drawn after it. Only one view has the focus at a time, so one step above the rest is enough.
 */
export const FOCUS_FRONT = { zIndex: 1 } as const satisfies ViewStyle
