import { isRecord } from '@raven/core'

/**
 * The remote's media keys, as the fork's `useTVEventHandler` names them: a Siri Remote has only
 * play and pause, an Android TV remote or a keyboard may have the rest.
 */
export const MEDIA_KEYS = {
  playPause: 'playPause',
  play: 'play',
  pause: 'pause',
  fastForward: 'fastForward',
  rewind: 'rewind',
  next: 'next',
  previous: 'previous',
} as const

type MediaKey = (typeof MEDIA_KEYS)[keyof typeof MEDIA_KEYS]

/** What each media key does to the queue, wherever the remote's focus is: the skip keys step a track. */
export const QUEUE_ACTIONS = {
  [MEDIA_KEYS.playPause]: 'toggle',
  [MEDIA_KEYS.play]: 'play',
  [MEDIA_KEYS.pause]: 'pause',
  [MEDIA_KEYS.fastForward]: 'next',
  [MEDIA_KEYS.rewind]: 'previous',
  [MEDIA_KEYS.next]: 'next',
  [MEDIA_KEYS.previous]: 'previous',
} as const satisfies Record<MediaKey, string>

export type QueueAction = (typeof QUEUE_ACTIONS)[MediaKey]

const isMediaKey = (name: string): name is MediaKey => Object.hasOwn(QUEUE_ACTIONS, name)

/** Android's `KeyEvent` actions, which the fork hands on with each key. */
const KEY_ACTIONS = { up: 1 } as const

/**
 * The queue action a remote event asks for, once, or null for any other key. On Android TV the
 * fork sends a key both as it goes down and as it comes up, so only its coming up counts; an
 * event that names no action (tvOS) counts as it comes.
 */
export const queueActionOf = (event: unknown): QueueAction | null => {
  if (!isRecord(event) || typeof event.eventType !== 'string') return null
  const action = event.eventKeyAction
  if (action !== undefined && action !== null && Number(action) !== KEY_ACTIONS.up) return null
  return isMediaKey(event.eventType) ? QUEUE_ACTIONS[event.eventType] : null
}
