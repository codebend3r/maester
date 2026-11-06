import { describe, expect, it } from 'bun:test'
import { BINGE_STATUS_KINDS, bingeCardFacts } from '@/binge'
import { ITEM_TYPES } from '@/contract'
import { itemDetails, itemSummary, mediaItem } from '@/test/fixtures'

const CAST = [
  { personId: 1, name: 'First Star', job: 'cast', role: 'A', photoVersion: null },
  { personId: 2, name: 'Director', job: 'director', role: 'Director', photoVersion: null },
  { personId: 3, name: 'Second Star', job: 'cast', role: 'B', photoVersion: null },
  { personId: 4, name: 'Third Star', job: 'cast', role: 'C', photoVersion: null },
] as const

const SHOW = itemDetails({
  ...itemSummary({ id: 4, type: ITEM_TYPES.show, title: 'Severance', year: 2022 }),
  summary: 'Mark leads a team of office workers.',
  runtime: 45,
  credits: [],
  versions: [],
})

const NEXT = mediaItem({
  id: 13,
  duration: 3300,
  position: 600,
  match: 'matched',
  item: itemSummary({
    id: 7,
    type: ITEM_TYPES.episode,
    title: 'Half Loop',
    year: 2022,
    show: { id: 4, title: 'Severance' },
    season: 1,
    episode: 2,
  }),
})

describe('bingeCardFacts', () => {
  it('gives a show the facts of the episode it is on: its words, length, time left and synopsis', () => {
    const facts = bingeCardFacts({
      details: { ...SHOW, credits: [...CAST] },
      next: NEXT,
      episode: itemDetails({ id: 7, type: ITEM_TYPES.episode, summary: 'Mark is told to go on.' }),
    })
    expect(facts).toEqual({
      year: '2022',
      runtime: '55m',
      stars: ['First Star', 'Second Star'],
      synopsis: 'Mark is told to go on.',
      episodeLine: 'S01E02 · Half Loop',
      status: { kind: BINGE_STATUS_KINDS.left, media: NEXT },
    })
  })

  it("falls back to the show's synopsis until its episode is read, and with no episode to play", () => {
    expect(bingeCardFacts({ details: SHOW, next: null, episode: null })).toMatchObject({
      synopsis: SHOW.summary,
      status: null,
      episodeLine: null,
      runtime: '45m',
    })
  })

  it('names the episode to start on until it is started', () => {
    const fresh = { ...NEXT, position: 0 }
    expect(bingeCardFacts({ details: SHOW, next: fresh, episode: null }).status).toEqual({
      kind: BINGE_STATUS_KINDS.start,
      season: 1,
      episode: 2,
    })
  })

  it('has no status for a file not started that is not a numbered episode', () => {
    const unnumbered = mediaItem({
      item: itemSummary({ type: ITEM_TYPES.episode, season: null, episode: null }),
    })
    expect(bingeCardFacts({ details: SHOW, next: unnumbered, episode: null }).status).toBeNull()
  })

  it('names fewer stars when the cast is short, and none when it is empty', () => {
    const short = { ...SHOW, credits: [CAST[0]] }
    expect(bingeCardFacts({ details: short, next: null, episode: null }).stars).toEqual([
      'First Star',
    ])
    expect(bingeCardFacts({ details: SHOW, next: null, episode: null }).stars).toEqual([])
  })
})
