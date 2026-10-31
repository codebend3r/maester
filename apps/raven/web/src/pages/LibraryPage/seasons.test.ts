import { describe, expect, it } from 'bun:test'
import { ITEM_TYPES } from '@raven/core'
import { seasonNext, seasonsOf } from '@/pages/LibraryPage/seasons'
import { itemSummary, mediaItem, showEntry } from '@/test/fixtures'

type EpisodeProps = { id: number; showId: number; season: number; episode: number }

const episode = ({ id, showId, season, episode: number }: EpisodeProps) =>
  mediaItem({
    id,
    item: itemSummary({
      id: id + 1000,
      type: ITEM_TYPES.episode,
      show: { id: showId, title: `Show ${showId}` },
      season,
      episode: number,
    }),
  })

const show = (id: number) =>
  showEntry({ show: itemSummary({ id, type: ITEM_TYPES.show, title: `Show ${id}` }) })

describe('seasonsOf', () => {
  it('lists each show in its order, its seasons by number with specials last', () => {
    const seasons = seasonsOf({
      shows: [show(2), show(1)],
      files: [
        episode({ id: 1, showId: 1, season: 1, episode: 1 }),
        episode({ id: 2, showId: 2, season: 0, episode: 1 }),
        episode({ id: 3, showId: 2, season: 2, episode: 1 }),
        episode({ id: 4, showId: 2, season: 1, episode: 2 }),
        episode({ id: 5, showId: 2, season: 1, episode: 1 }),
      ],
    })
    expect(seasons.map(({ show: { id }, season }) => [id, season])).toEqual([
      [2, 1],
      [2, 2],
      [2, 0],
      [1, 1],
    ])
    expect(seasons[0]?.episodes.map(({ id }) => id) ?? null).toEqual([5, 4])
  })

  it('leaves out files no show was found for, and shows the listing does not hold', () => {
    const unmatched = mediaItem({ id: 9, item: null })
    const seasons = seasonsOf({
      shows: [show(1)],
      files: [unmatched, episode({ id: 2, showId: 3, season: 1, episode: 1 })],
    })
    expect(seasons).toEqual([])
  })
})

describe('seasonNext', () => {
  it('starts on the first episode not yet watched', () => {
    const first = { ...episode({ id: 1, showId: 1, season: 1, episode: 1 }), watched: true }
    const second = episode({ id: 2, showId: 1, season: 1, episode: 2 })
    const [season] = seasonsOf({ shows: [show(1)], files: [first, second] })
    expect(seasonNext(season!)?.id ?? null).toBe(2)
  })
})
