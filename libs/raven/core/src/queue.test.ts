import { describe, expect, it } from 'bun:test'
import {
  QUEUE_SOURCE_KINDS,
  EMPTY_QUEUE,
  REPEAT_MODES,
  afterEnd,
  append,
  currentOf,
  insertNext,
  jump,
  move,
  next,
  nextRepeat,
  orderedOf,
  previous,
  remove,
  setRepeat,
  shuffle,
  startQueue,
  unshuffle,
} from '@/queue'

const ALBUM = [10, 11, 12, 13]

/** A "random" that always picks the last place, so a shuffle reverses nothing and the order is known. */
const stays = () => 0.999

describe('startQueue', () => {
  it('queues the items in order from the start asked, clamped', () => {
    const queue = startQueue({
      items: ALBUM,
      startAt: 2,
      source: { kind: QUEUE_SOURCE_KINDS.album, id: 7 },
    })
    expect(currentOf(queue)).toBe(12)
    expect(orderedOf(queue).map(({ id }) => id)).toEqual(ALBUM)
    expect(queue.source).toEqual({ kind: QUEUE_SOURCE_KINDS.album, id: 7 })
    expect(currentOf(startQueue({ items: ALBUM, startAt: 99 }))).toBe(13)
    expect(currentOf(startQueue({ items: ALBUM, startAt: -1 }))).toBe(10)
  })

  it('is empty for no items', () => {
    expect(startQueue({ items: [] })).toEqual(EMPTY_QUEUE)
    expect(currentOf(EMPTY_QUEUE)).toBeNull()
    expect(orderedOf(EMPTY_QUEUE)).toEqual([])
  })

  it('starts shuffled on the first of a random order', () => {
    const queue = startQueue({ items: ALBUM, isShuffled: true, random: stays })
    expect(queue.isShuffled).toBe(true)
    expect(queue.at).toBe(0)
    expect(new Set(orderedOf(queue).map(({ id }) => id))).toEqual(new Set(ALBUM))
  })
})

describe('next, previous, afterEnd', () => {
  it('steps through, runs out at the end with repeat off, and starts over with repeat all', () => {
    const last = jump({ queue: startQueue({ items: ALBUM }), place: 3 })
    expect(currentOf(next(startQueue({ items: ALBUM })))).toBe(11)
    expect(next(last).at).toBeNull()
    expect(currentOf(next(setRepeat({ queue: last, repeat: REPEAT_MODES.all })))).toBe(10)
  })

  it('plays the same track again at its end under repeat one, but Next still steps on', () => {
    const one = setRepeat({ queue: startQueue({ items: ALBUM }), repeat: REPEAT_MODES.one })
    expect(currentOf(afterEnd(one))).toBe(10)
    expect(currentOf(next(one))).toBe(11)
    expect(currentOf(afterEnd(startQueue({ items: ALBUM })))).toBe(11)
  })

  it('steps back, and the first stays first', () => {
    const second = next(startQueue({ items: ALBUM }))
    expect(currentOf(previous(second))).toBe(10)
    expect(currentOf(previous(previous(second)))).toBe(10)
  })

  it('does nothing to an empty or run-out queue', () => {
    expect(next(EMPTY_QUEUE)).toEqual(EMPTY_QUEUE)
    expect(previous(EMPTY_QUEUE)).toEqual(EMPTY_QUEUE)
  })
})

describe('insertNext and append', () => {
  it('puts tracks right after the playing one, or at the end', () => {
    const queue = startQueue({ items: ALBUM })
    const after = (changed: ReturnType<typeof append>) =>
      orderedOf(changed)
        .map(({ id }) => id)
        .slice(1)
    expect(after(insertNext({ queue, ids: [20, 21] }))).toEqual([20, 21, 11, 12, 13])
    expect(after(append({ queue, ids: [20] }))).toEqual([11, 12, 13, 20])
  })

  it('starts an empty queue on what is added', () => {
    expect(currentOf(append({ queue: EMPTY_QUEUE, ids: [20, 21] }))).toBe(20)
    expect(currentOf(insertNext({ queue: EMPTY_QUEUE, ids: [20] }))).toBe(20)
    expect(append({ queue: EMPTY_QUEUE, ids: [] })).toEqual(EMPTY_QUEUE)
  })
})

describe('remove and move', () => {
  it('takes a track out before, at and after the playing one', () => {
    const queue = jump({ queue: startQueue({ items: ALBUM }), place: 1 })
    const before = remove({ queue, place: 0 })
    expect(currentOf(before)).toBe(11)
    expect(orderedOf(before).map(({ id }) => id)).toEqual([11, 12, 13])
    const playing = remove({ queue, place: 1 })
    expect(currentOf(playing)).toBe(12)
    const after = remove({ queue, place: 3 })
    expect(currentOf(after)).toBe(11)
    expect(orderedOf(after).map(({ id }) => id)).toEqual([10, 11, 12])
  })

  it('leaves the queue run out when the last playing track is removed', () => {
    const last = jump({ queue: startQueue({ items: ALBUM }), place: 3 })
    expect(remove({ queue: last, place: 3 }).at).toBeNull()
    expect(remove({ queue: last, place: 9 })).toEqual(last)
  })

  it('moves a track within the play order, the playing track still playing', () => {
    const queue = next(startQueue({ items: ALBUM }))
    const moved = move({ queue, from: 3, to: 0 })
    expect(orderedOf(moved).map(({ id }) => id)).toEqual([13, 10, 11, 12])
    expect(currentOf(moved)).toBe(11)
    expect(move({ queue, from: 1, to: 1 })).toEqual(queue)
    expect(move({ queue, from: 1, to: 9 })).toEqual(queue)
  })
})

describe('shuffle and unshuffle', () => {
  it('shuffles what is still to play, the playing track staying put, and puts it back', () => {
    const queue = next(startQueue({ items: ALBUM }))
    const shuffled = shuffle({ queue, random: stays })
    expect(shuffled.isShuffled).toBe(true)
    expect(currentOf(shuffled)).toBe(11)
    expect(
      orderedOf(shuffled)
        .map(({ id }) => id)
        .slice(0, 2),
    ).toEqual([10, 11])
    expect(
      new Set(
        orderedOf(shuffled)
          .map(({ id }) => id)
          .slice(2),
      ),
    ).toEqual(new Set([12, 13]))
    const back = unshuffle(shuffled)
    expect(back.isShuffled).toBe(false)
    expect(orderedOf(back).map(({ id }) => id)).toEqual(ALBUM)
    expect(currentOf(back)).toBe(11)
  })

  it('shuffles every track of a queue not yet started', () => {
    const shuffled = shuffle({
      queue: { ...startQueue({ items: ALBUM }), at: null },
      random: stays,
    })
    expect(new Set(orderedOf(shuffled).map(({ id }) => id))).toEqual(new Set(ALBUM))
    expect(shuffled.at).toBeNull()
  })
})

describe('nextRepeat', () => {
  it('cycles off, all, one', () => {
    expect(nextRepeat(REPEAT_MODES.off)).toBe(REPEAT_MODES.all)
    expect(nextRepeat(REPEAT_MODES.all)).toBe(REPEAT_MODES.one)
    expect(nextRepeat(REPEAT_MODES.one)).toBe(REPEAT_MODES.off)
  })
})
