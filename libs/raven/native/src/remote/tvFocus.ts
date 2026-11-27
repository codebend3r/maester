import { isRecord } from '@raven/core'

/**
 * A host view the tvOS fork has given its `requestTVFocus`, which React Native's types leave
 * out.
 */
type TVFocusable = { requestTVFocus: () => void }

const canTakeTVFocus = (value: unknown): value is TVFocusable =>
  isRecord(value) && typeof value.requestTVFocus === 'function'

/**
 * Moves the remote's focus to the view `instance` holds, once it is on screen. A control that
 * mounts already asking for the focus (`hasTVPreferredFocus`) asks before it is in the
 * window, and the fork's retry for that takes only the first time, so raven's cards and Wren on
 * TV's controls ask again through this once they are drawn.
 */
export const requestTVFocus = (instance: unknown): void => {
  if (canTakeTVFocus(instance)) instance.requestTVFocus()
}
