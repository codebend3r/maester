import { describe, expect, it } from 'bun:test'
import { ITEM_TYPES, type MediaItem, SESSION_KINDS, type ViewingSession } from '@/contract'
import { carriesItsOrder, queueStopsOf, sessionOrderOf } from '@/sessionQueue'
import { itemSummary, mediaItem } from '@/test/fixtures'

const episode = (number: number) =>
  mediaItem({
    id: number,
    title: `Episode ${number}`,
    item: itemSummary({
      id: 100 + number,
      type: ITEM_TYPES.episode,
      title: `Episode ${number}`,
      show: { id: 50, title: 'Lantern Bay' },
      season: 1,
      episode: number,
    }),
  })

const [one, two, three] = [episode(1), episode(2), episode(3)]
const SHOW: ViewingSession = { kind: SESSION_KINDS.show }
const QUEUE: ViewingSession = { kind: SESSION_KINDS.queue }
const SHUFFLE: ViewingSession = { kind: SESSION_KINDS.shuffle, showId: '50' }

const ids = (media: readonly MediaItem[]) => media.map(({ id }) => id)

describe('sessionOrderOf', () => {
  it("splits a season's episodes round the one playing", () => {
    const order = sessionOrderOf({
      media: two,
      session: SHOW,
      played: [],
      upNext: [],
      ordered: [one, two, three],
      found: three,
    })
    expect(ids(order.before)).toEqual([1])
    expect(ids(order.after)).toEqual([3])
  })

  it('finds the episode by its title when another of its files plays', () => {
    const copy = { ...two, id: 22 }
    const order = sessionOrderOf({
      media: copy,
      session: SHOW,
      played: [],
      upNext: [],
      ordered: [one, two, three],
      found: null,
    })
    expect(ids(order.before)).toEqual([1])
  })

  it("rolls a show on past its season's last episode", () => {
    const next = episode(9)
    const order = sessionOrderOf({
      media: three,
      session: SHOW,
      played: [],
      upNext: [],
      ordered: [one, two, three],
      found: next,
    })
    expect(ids(order.after)).toEqual([9])
  })

  it('offers only what the server found while the order is not in', () => {
    const order = sessionOrderOf({
      media: one,
      session: SHOW,
      played: [],
      upNext: [],
      ordered: null,
      found: two,
    })
    expect(order).toEqual({ before: [], after: [two] })
  })

  it("reads a queue's order off its link, and a shuffle's off what it played and drew", () => {
    const queue = sessionOrderOf({
      media: two,
      session: QUEUE,
      played: [three],
      upNext: [one],
      ordered: null,
      found: null,
    })
    expect(queue).toEqual({ before: [three], after: [one] })
    const shuffle = sessionOrderOf({
      media: two,
      session: SHUFFLE,
      played: [three],
      upNext: [],
      ordered: null,
      found: one,
    })
    expect(shuffle).toEqual({ before: [three], after: [one] })
  })
})

describe('queueStopsOf', () => {
  it("links a season's episodes in its session, with nothing carried", () => {
    const stops = queueStopsOf({
      media: two,
      session: SHOW,
      order: { before: [one], after: [three] },
      shuffledFrom: null,
    })
    expect(stops.map(({ isCurrent }) => isCurrent)).toEqual([false, true, false])
    expect(stops[0]?.link).toEqual({
      to: '/watch/1',
      state: { media: one, session: SHOW, upNext: [] },
    })
  })

  it('carries what comes after and what came before each stop of a queue', () => {
    const stops = queueStopsOf({
      media: two,
      session: QUEUE,
      order: { before: [three], after: [one] },
      shuffledFrom: SHOW,
    })
    expect(stops[0]?.link.state).toEqual({
      media: three,
      session: QUEUE,
      upNext: [two, one],
      shuffledFrom: SHOW,
    })
    expect(stops[2]?.link.state).toEqual({
      media: one,
      session: QUEUE,
      upNext: [],
      played: [three, two],
      shuffledFrom: SHOW,
    })
  })

  it('leaves the next of a shuffle with no end to the server', () => {
    const stops = queueStopsOf({
      media: two,
      session: SHUFFLE,
      order: { before: [], after: [one] },
      shuffledFrom: null,
    })
    expect(stops[1]?.link.state).toEqual({
      media: one,
      session: SHUFFLE,
      upNext: [],
      played: [two],
    })
  })
})

describe('carriesItsOrder', () => {
  it('holds for a queue and a shuffle, whose links carry their order, and for nothing else', () => {
    expect([QUEUE, SHUFFLE, SHOW].map(carriesItsOrder)).toEqual([true, true, false])
  })
})
