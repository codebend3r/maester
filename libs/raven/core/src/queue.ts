import { type Infer, isNumber, listOf, nullable, object, oneOf } from '@/schema'

/** What happens at the end of the queue: it stops, starts over, or the track plays again. */
export const REPEAT_MODES = { off: 'off', all: 'all', one: 'one' } as const

export const isRepeatMode = oneOf(Object.values(REPEAT_MODES))

export type RepeatMode = Infer<typeof isRepeatMode>

/** Where a queue was started from, so Now Playing can name it and link back. */
export const QUEUE_SOURCE_KINDS = {
  album: 'album',
  artist: 'artist',
  library: 'library',
} as const

export const isQueueSource = object({
  kind: oneOf(Object.values(QUEUE_SOURCE_KINDS)),
  id: isNumber,
})

export type QueueSource = Infer<typeof isQueueSource>

/**
 * A queue of tracks by media id, platform-agnostic, so every raven client
 * steps it the same way. `items` are the tracks in the order they were
 * queued; `order` is the order they play in, as indexes into `items`,
 * which a shuffle permutes; `at` is where in `order` the playing track is,
 * null for an empty queue or one that has run out.
 */
export const isQueue = object({
  items: listOf(isNumber),
  order: listOf(isNumber),
  at: nullable(isNumber),
  repeat: isRepeatMode,
  isShuffled: oneOf([true, false]),
  source: nullable(isQueueSource),
})

export type Queue = Infer<typeof isQueue>

export const EMPTY_QUEUE: Queue = {
  items: [],
  order: [],
  at: null,
  repeat: REPEAT_MODES.off,
  isShuffled: false,
  source: null,
}

/** How far into a track Previous restarts it rather than stepping back, in seconds. */
export const RESTART_AFTER_S = 3

/** The media id playing, or null for none. */
export const currentOf = (queue: Queue): number | null => {
  if (queue.at === null) return null
  const index = queue.order[queue.at]
  return index === undefined ? null : (queue.items[index] ?? null)
}

/** The whole queue in play order, for the queue page: each media id and whether it is the one playing. */
export const orderedOf = (queue: Queue): { id: number; isCurrent: boolean }[] =>
  queue.order.flatMap((index, place) => {
    const id = queue.items[index]
    return id === undefined ? [] : [{ id, isCurrent: place === queue.at }]
  })

type StartQueueProps = {
  items: readonly number[]
  /** The index into `items` to start at; 0 when left out, and ignored when shuffling. */
  startAt?: number
  source?: QueueSource | null
  repeat?: RepeatMode
  /** Whether to play `items` in a random order from the first of it. */
  isShuffled?: boolean
  /** A number in [0, 1) each time it is called, as `Math.random` gives one. */
  random?: () => number
}

/** A queue of `items` in their order, playing from `startAt`, or in a random order; empty for no items. */
export const startQueue = ({
  items,
  startAt = 0,
  source = null,
  repeat = REPEAT_MODES.off,
  isShuffled = false,
  random = Math.random,
}: StartQueueProps): Queue => {
  if (items.length === 0) return { ...EMPTY_QUEUE, repeat, source }
  const inOrder = items.map((_, index) => index)
  return {
    items: [...items],
    order: isShuffled ? fisherYates({ list: inOrder, random }) : inOrder,
    at: isShuffled ? 0 : Math.min(Math.max(startAt, 0), items.length - 1),
    repeat,
    isShuffled,
    source,
  }
}

type MovedToProps = { queue: Queue; at: number | null }

const movedTo = ({ queue, at }: MovedToProps): Queue => ({ ...queue, at })

/**
 * What plays after the current track ends, or Next is pressed: the next in
 * order; past the end, the first again under repeat all, nothing under
 * repeat off. Repeat one plays the same track again when it ends, but Next
 * still steps on, as every player does.
 */
export const next = (queue: Queue): Queue => {
  if (queue.at === null) return queue
  if (queue.at + 1 < queue.order.length) return movedTo({ queue, at: queue.at + 1 })
  return queue.repeat === REPEAT_MODES.off
    ? movedTo({ queue, at: null })
    : movedTo({ queue, at: 0 })
}

/** What plays when the current track ends: the same one again under repeat one. */
export const afterEnd = (queue: Queue): Queue =>
  queue.repeat === REPEAT_MODES.one ? queue : next(queue)

/** The track before the current one; the first stays first. */
export const previous = (queue: Queue): Queue =>
  queue.at === null ? queue : movedTo({ queue, at: Math.max(queue.at - 1, 0) })

type JumpProps = { queue: Queue; place: number }

/** Jumps to the track at `place` in play order. */
export const jump = ({ queue, place }: JumpProps): Queue =>
  place >= 0 && place < queue.order.length ? movedTo({ queue, at: place }) : queue

type InsertNextProps = { queue: Queue; ids: readonly number[] }

/** Puts `ids` right after the current track in play order. */
export const insertNext = ({ queue, ids }: InsertNextProps): Queue => {
  if (ids.length === 0) return queue
  const items = [...queue.items, ...ids]
  const added = ids.map((_, offset) => queue.items.length + offset)
  const cut = queue.at === null ? 0 : queue.at + 1
  return {
    ...queue,
    items,
    order: [...queue.order.slice(0, cut), ...added, ...queue.order.slice(cut)],
    at: queue.at ?? 0,
  }
}

type AppendProps = { queue: Queue; ids: readonly number[] }

/** Adds `ids` to the end of the queue. */
export const append = ({ queue, ids }: AppendProps): Queue => {
  if (ids.length === 0) return queue
  const added = ids.map((_, offset) => queue.items.length + offset)
  return {
    ...queue,
    items: [...queue.items, ...ids],
    order: [...queue.order, ...added],
    at: queue.at ?? 0,
  }
}

type RemoveProps = { queue: Queue; place: number }

/**
 * Takes the track at `place` in play order out. Removing the playing track
 * moves on to the next; removing the last one leaves the queue run out.
 */
export const remove = ({ queue, place }: RemoveProps): Queue => {
  const index = queue.order[place]
  if (index === undefined) return queue
  const items = queue.items.filter((_, each) => each !== index)
  const order = queue.order
    .filter((_, each) => each !== place)
    .map((each) => (each > index ? each - 1 : each))
  const at = atAfterRemove({ at: queue.at, place, length: order.length })
  return { ...queue, items, order, at }
}

type AtAfterRemoveProps = { at: number | null; place: number; length: number }

/** Where the play position lands once `place` is gone: a step back past it, the same before it, run out past the end. */
const atAfterRemove = ({ at, place, length }: AtAfterRemoveProps): number | null => {
  if (at === null) return null
  if (place < at) return at - 1
  return at < length ? at : null
}

type MoveProps = { queue: Queue; from: number; to: number }

/** Moves the track at `from` in play order to `to`; the playing track stays the playing track. */
export const move = ({ queue, from, to }: MoveProps): Queue => {
  const index = queue.order[from]
  if (index === undefined || to < 0 || to >= queue.order.length || from === to) return queue
  const without = queue.order.filter((_, each) => each !== from)
  const order = [...without.slice(0, to), index, ...without.slice(to)]
  const playing = queue.at === null ? null : queue.order[queue.at]
  const at = playing === undefined || playing === null ? null : order.indexOf(playing)
  return { ...queue, order, at: at === -1 ? null : at }
}

type ShuffleProps = {
  queue: Queue
  /** A number in [0, 1) each time it is called, as `Math.random` gives one. */
  random?: () => number
}

/** Shuffles what is still to play after the current track, which stays where it is. */
export const shuffle = ({ queue, random = Math.random }: ShuffleProps): Queue => {
  if (queue.at === null) {
    const order = fisherYates({ list: queue.order, random })
    return { ...queue, order, isShuffled: true }
  }
  const rest = fisherYates({ list: queue.order.slice(queue.at + 1), random })
  return { ...queue, order: [...queue.order.slice(0, queue.at + 1), ...rest], isShuffled: true }
}

/** Puts the queue back in the order its tracks were queued, the playing track still playing. */
export const unshuffle = (queue: Queue): Queue => {
  const playing = queue.at === null ? null : queue.order[queue.at]
  const order = queue.items.map((_, index) => index)
  return {
    ...queue,
    order,
    at: playing === undefined || playing === null ? null : playing,
    isShuffled: false,
  }
}

type SetRepeatProps = { queue: Queue; repeat: RepeatMode }

export const setRepeat = ({ queue, repeat }: SetRepeatProps): Queue => ({ ...queue, repeat })

/** The next repeat mode as one button cycles them: off, all, one. */
export const nextRepeat = (repeat: RepeatMode): RepeatMode => {
  switch (repeat) {
    case REPEAT_MODES.off:
      return REPEAT_MODES.all
    case REPEAT_MODES.all:
      return REPEAT_MODES.one
    case REPEAT_MODES.one:
      return REPEAT_MODES.off
    default: {
      const unknown: never = repeat
      return unknown
    }
  }
}

type FisherYatesProps = { list: readonly number[]; random: () => number }

const fisherYates = ({ list, random }: FisherYatesProps): number[] =>
  list.reduce<number[]>((shuffled, item, index) => {
    const at = Math.floor(random() * (index + 1))
    const grown = [...shuffled, item]
    return grown.with(index, grown[at] ?? item).with(at, item)
  }, [])
