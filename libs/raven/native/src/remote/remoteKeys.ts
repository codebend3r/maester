import { isRecord, oneOf } from '@raven/core'

/**
 * The remote's keys raven's player answers, as the fork's `useTVEventHandler` names them: a
 * Siri Remote has the d-pad, select and play and pause; an Android TV remote or a keyboard may
 * have the rest.
 */
export const REMOTE_KEYS = {
  left: 'left',
  right: 'right',
  up: 'up',
  down: 'down',
  select: 'select',
  playPause: 'playPause',
  play: 'play',
  pause: 'pause',
  rewind: 'rewind',
  fastForward: 'fastForward',
} as const

/** The media keys that skip a track, which Wren's queue answers and raven's player leaves alone. */
export const MEDIA_SKIP_KEYS = { next: 'next', previous: 'previous' } as const

export type MediaSkipKey = (typeof MEDIA_SKIP_KEYS)[keyof typeof MEDIA_SKIP_KEYS]

export type RemoteKey = (typeof REMOTE_KEYS)[keyof typeof REMOTE_KEYS]

const isRemoteKey = oneOf(Object.values(REMOTE_KEYS))

/** The names the fork's Android helper gives a key held down (only the d-pad and select). */
export const LONG_PRESS_NAMES = {
  longLeft: 'longLeft',
  longRight: 'longRight',
  longUp: 'longUp',
  longDown: 'longDown',
  longSelect: 'longSelect',
} as const

/** A key held down, by the fork's name for it, and the key it is. */
export const LONG_PRESSES = {
  [LONG_PRESS_NAMES.longLeft]: REMOTE_KEYS.left,
  [LONG_PRESS_NAMES.longRight]: REMOTE_KEYS.right,
  [LONG_PRESS_NAMES.longUp]: REMOTE_KEYS.up,
  [LONG_PRESS_NAMES.longDown]: REMOTE_KEYS.down,
  [LONG_PRESS_NAMES.longSelect]: REMOTE_KEYS.select,
} as const

// Its own keys only: `in` would also pass a name an object inherits, such as `toString`.
export const isLongPress = (name: string): name is keyof typeof LONG_PRESSES =>
  Object.hasOwn(LONG_PRESSES, name)

/** Android's `KeyEvent` actions, which the fork hands on with each key. */
export const KEY_ACTIONS = { down: 0, up: 1 } as const

/**
 * The name a remote event gives its key, once, or null for an event that names none. On Android
 * TV the fork sends a key as it comes up (and, with its key-down events on, as it goes down), so
 * only its coming up counts. The fork's types call the action a string, but Android sends its
 * `KeyEvent`'s, a number; an event naming none (tvOS) counts as it comes.
 */
export const keyUpNameOf = (event: unknown): string | null => {
  if (!isRecord(event) || typeof event.eventType !== 'string') return null
  const action = event.eventKeyAction
  if (action !== undefined && action !== null && Number(action) !== KEY_ACTIONS.up) return null
  return event.eventType
}

/**
 * The key a remote event presses, once, as `keyUpNameOf` counts it. The fork sends a key held
 * down as its long name, once going down and once coming up, so a held one counts as the key it
 * is, as it is let go.
 */
export const pressedKeyOf = (event: unknown): RemoteKey | null => {
  const name = keyUpNameOf(event)
  if (name === null) return null
  if (isLongPress(name)) return LONG_PRESSES[name]
  return isRemoteKey(name) ? name : null
}
