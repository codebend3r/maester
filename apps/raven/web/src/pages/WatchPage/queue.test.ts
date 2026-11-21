import { describe, expect, it } from 'bun:test'
import { ITEM_TYPES, SESSION_KINDS, type ViewingSession, queueStopsOf } from '@raven/core'
import { queueEntryOf } from '@/pages/WatchPage/queue'
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

const one = episode(1)
const SHOW: ViewingSession = { kind: SESSION_KINDS.show }

describe('queueEntryOf', () => {
  it('names a stop and where its episode falls', () => {
    const [stop] = queueStopsOf({
      media: one,
      session: SHOW,
      order: { before: [], after: [] },
      shuffledFrom: null,
    })
    if (stop === undefined) throw new Error('The queue holds the video playing.')
    expect(queueEntryOf({ stop, at: 0 })).toMatchObject({
      key: '0:1',
      to: '/watch/1',
      detail: 'Season 1, Episode 1',
      isCurrent: true,
    })
  })
})
