import {
  MEDIA_SKIP_KEYS,
  type MediaSkipKey,
  REMOTE_KEYS,
  type RemoteKey,
  keyUpNameOf,
} from '@raven/native/headless'

/** What each media key does to the queue, wherever the remote's focus is: the skip keys step a track. */
export const QUEUE_ACTIONS = {
  [REMOTE_KEYS.playPause]: 'toggle',
  [REMOTE_KEYS.play]: 'play',
  [REMOTE_KEYS.pause]: 'pause',
  [REMOTE_KEYS.fastForward]: 'next',
  [REMOTE_KEYS.rewind]: 'previous',
  [MEDIA_SKIP_KEYS.next]: 'next',
  [MEDIA_SKIP_KEYS.previous]: 'previous',
} as const satisfies Partial<Record<RemoteKey | MediaSkipKey, string>>

type MediaKey = keyof typeof QUEUE_ACTIONS

export type QueueAction = (typeof QUEUE_ACTIONS)[MediaKey]

const isMediaKey = (name: string): name is MediaKey => Object.hasOwn(QUEUE_ACTIONS, name)

/** The queue action a remote event asks for, once, as `keyUpNameOf` counts it, or null for any other key. */
export const queueActionOf = (event: unknown): QueueAction | null => {
  const key = keyUpNameOf(event)
  return key !== null && isMediaKey(key) ? QUEUE_ACTIONS[key] : null
}
