import { isRecord } from '@raven/core'

/**
 * A host view the tvOS fork has given its `requestTVFocus`, which React Native's types leave
 * out.
 */
const canTakeTVFocus = (value: unknown): value is { requestTVFocus: () => void } =>
  isRecord(value) && typeof value.requestTVFocus === 'function'

/**
 * Moves the remote's focus to the view `instance` holds, once it is on screen. A card that
 * mounts already asking for the focus (`hasTVPreferredFocus`) asks before it is in the
 * window, and the fork's retry for that takes only the first time, so a jump asks again here.
 */
export const requestTVFocus = (instance: unknown): void => {
  if (canTakeTVFocus(instance)) instance.requestTVFocus()
}
