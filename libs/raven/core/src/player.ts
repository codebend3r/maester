import { isMediaTracks } from '@/contract'
import {
  type Infer,
  isBoolean,
  isNumber,
  isString,
  listOf,
  nullable,
  object,
  oneOf,
  union,
} from '@/schema'

/**
 * What the player opens. The renderer names a server title or a file the
 * main process granted it, never a path or a URL.
 */
export const isPlayerSource = union(
  object({ kind: oneOf(['server']), serverId: isString, mediaId: isNumber }),
  object({ kind: oneOf(['file']), fileId: isString }),
)

export type PlayerSource = Infer<typeof isPlayerSource>

export const isPlayerCommand = union(
  object({
    type: oneOf(['load']),
    source: isPlayerSource,
    start: isNumber,
    audio: nullable(isNumber),
    subtitle: nullable(isString),
  }),
  object({ type: oneOf(['play']) }),
  object({ type: oneOf(['pause']) }),
  object({ type: oneOf(['seek']), time: isNumber }),
  object({ type: oneOf(['audio']), index: nullable(isNumber) }),
  object({ type: oneOf(['subtitle']), id: nullable(isString) }),
  object({ type: oneOf(['volume']), volume: isNumber, muted: isBoolean }),
  object({ type: oneOf(['speed']), rate: isNumber }),
  object({ type: oneOf(['subtitleScale']), scale: isNumber }),
  object({ type: oneOf(['stats']) }),
  object({ type: oneOf(['stop']) }),
)

export type PlayerCommand = Infer<typeof isPlayerCommand>

const isTimeRange = object({ start: isNumber, end: isNumber })

export const isPlayerErrorReason = oneOf(['open', 'decode', 'network', 'locked', 'engine'])

export const isPlayerEvent = union(
  object({ type: oneOf(['time']), time: isNumber }),
  object({ type: oneOf(['buffered']), ranges: listOf(isTimeRange) }),
  object({ type: oneOf(['paused']), paused: isBoolean }),
  object({ type: oneOf(['waiting']), waiting: isBoolean }),
  object({ type: oneOf(['duration']), duration: nullable(isNumber) }),
  object({ type: oneOf(['rate']), rate: isNumber }),
  object({ type: oneOf(['tracks']), tracks: isMediaTracks }),
  object({ type: oneOf(['ended']) }),
  object({ type: oneOf(['error']), reason: isPlayerErrorReason, message: isString }),
)

export type PlayerEvent = Infer<typeof isPlayerEvent>

/** A command on the player's MessagePort, answered by a reply with the same id. */
export const isPlayerRequest = object({ id: isNumber, command: isPlayerCommand })

export const isPlayerReply = union(
  object({ id: isNumber, ok: oneOf([true]) }),
  object({ id: isNumber, ok: oneOf([false]), message: isString }),
)
