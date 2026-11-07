import { describe, expect, it } from 'bun:test'
import { CREDIT_JOBS, ITEM_TYPES, type ItemDetails } from '@raven/core'

import { BINGE_COPY, bingeArtLabelOf, bingeCardOf } from '@/queries/bingeCards'
import { CARD_SHAPES } from '@/queries/cards'
import { ROUTE_TARGETS } from '@/routes'
import { NAS, homeApi } from '@/test/homeServer'
import { mediaItemFor, summaryFor } from '@/test/mediaItem'

const headersFor = () => ({})

const SHOW: ItemDetails = {
  ...summaryFor({ id: 4, type: ITEM_TYPES.show, title: 'Severance', backdropVersion: 'b3' }),
  tmdbId: '4',
  imdbId: null,
  originalTitle: null,
  tagline: null,
  summary: 'A show about work.',
  contentRating: null,
  released: null,
  ended: null,
  runtime: null,
  studio: null,
  genres: [],
  logoVersion: 'l2',
  favourite: null,
  aiMatch: null,
  credits: [],
  reviews: [],
  versions: [],
  children: [],
  libraryPictures: [],
}

const EPISODE = summaryFor({
  id: 9,
  type: ITEM_TYPES.episode,
  title: 'Half Loop',
  season: 1,
  episode: 2,
  show: summaryFor({ id: 4, type: ITEM_TYPES.show, title: 'Severance' }),
})

const NEXT = mediaItemFor({ id: 70, item: EPISODE, duration: 3000, position: 600 })

const PAGE = { kind: ROUTE_TARGETS.item, itemId: SHOW.id, libraryId: null, fileId: null }

describe('bingeCardOf', () => {
  it("writes the web card's facts: year and length, the two leading stars, the quality", () => {
    const card = bingeCardOf({
      show: {
        ...SHOW,
        year: 2022,
        credits: [
          {
            personId: 1,
            name: 'Adam Scott',
            job: CREDIT_JOBS.cast,
            role: null,
            photoVersion: null,
          },
          {
            personId: 2,
            name: 'Britt Lower',
            job: CREDIT_JOBS.cast,
            role: null,
            photoVersion: null,
          },
          {
            personId: 3,
            name: 'Zach Cherry',
            job: CREDIT_JOBS.cast,
            role: null,
            photoVersion: null,
          },
        ],
      },
      next: { ...NEXT, width: 3840, height: 2160, hdr: true, videoCodec: 'hevc' },
      episode: null,
      api: homeApi(),
      headersFor,
    })
    expect(card.meta).toBe('2022 · 50m')
    expect(card.stars).toBe('Adam Scott, Britt Lower')
    expect((card.chips ?? []).map(({ text }) => text)).toEqual(['4K', 'HDR', 'HEVC'])
  })

  it('says which episode a show starts on before it is started', () => {
    const card = bingeCardOf({
      show: SHOW,
      next: { ...NEXT, position: 0 },
      episode: null,
      api: homeApi(),
      headersFor,
    })
    expect(card.status).toBe(BINGE_COPY.start({ season: 1, episode: 2 }))
  })

  it('plays the episode the show is on, wide on its backdrop with its title art', () => {
    const card = bingeCardOf({
      show: SHOW,
      next: NEXT,
      episode: null,
      api: homeApi(),
      headersFor,
    })
    expect(card).toMatchObject({
      key: 'binge:4',
      title: 'Severance',
      shape: CARD_SHAPES.wide,
      target: { kind: ROUTE_TARGETS.play, mediaId: 70, at: 0 },
      page: PAGE,
      episodeLine: 'S01E02 · Half Loop',
      status: '40m left',
      synopsis: 'A show about work.',
    })
    expect(card.picture?.uri.startsWith(NAS.origin)).toBe(true)
    expect(card.logo).not.toBeNull()
    expect(card.progress).toBeCloseTo(0.2)
  })

  it("takes the episode's synopsis over the show's once its page is read", () => {
    const card = bingeCardOf({
      show: SHOW,
      next: NEXT,
      episode: { ...SHOW, ...EPISODE, summary: 'Mark goes back in.' },
      api: homeApi(),
      headersFor,
    })
    expect(card.synopsis).toBe('Mark goes back in.')
  })

  it("opens the show's page when no episode is left", () => {
    const card = bingeCardOf({ show: SHOW, next: null, episode: null, api: homeApi(), headersFor })
    expect(card.target).toEqual(PAGE)
    expect(card.progress).toBe(0)
    expect(card.episodeLine).toBeNull()
    expect(card.status).toBeNull()
  })

  it("names the title art's way to the show's page", () => {
    expect(bingeArtLabelOf(SHOW)).toBe(`${BINGE_COPY.goTo} Severance`)
  })
})
