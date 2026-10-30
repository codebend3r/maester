import { ITEM_TYPES } from '@raven/core'
import { describe, expect, it } from 'bun:test'

import { playerHeadingOf } from '@/layouts/playerHeading'
import { mediaItemFor, summaryFor } from '@/test/mediaItem'

const LOGO = { uri: 'https://nas.example/api/items/1/images/logo?v=1', headers: {} }

type EpisodeProps = { season: number }

const episode = ({ season }: EpisodeProps) =>
  mediaItemFor({
    duration: 2513,
    item: summaryFor({
      id: 3,
      title: 'Bad Tradecraft',
      type: ITEM_TYPES.episode,
      show: { id: 1, title: 'Slow Horses' },
      season,
      episode: 3,
    }),
  })

describe('playerHeadingOf', () => {
  it('sets an episode out as its show and its art, its place, then its name and length', () => {
    expect(playerHeadingOf({ media: episode({ season: 1 }), logo: LOGO })).toEqual({
      show: 'Slow Horses',
      logo: LOGO,
      place: 'S01 · E03',
      title: 'Bad Tradecraft',
      length: '42m',
    })
  })

  it("names a special as core's episode place does", () => {
    expect(playerHeadingOf({ media: episode({ season: 0 }), logo: null }).place).toBe('Special 3')
  })

  it('gives a film its name and year alone, with its length and its own art', () => {
    const media = mediaItemFor({
      duration: 7380,
      item: summaryFor({ id: 4, title: 'Valhalla Rising', year: 2010 }),
    })
    expect(playerHeadingOf({ media, logo: LOGO })).toEqual({
      show: null,
      logo: LOGO,
      place: null,
      title: 'Valhalla Rising (2010)',
      length: '2h 3m',
    })
  })
})
