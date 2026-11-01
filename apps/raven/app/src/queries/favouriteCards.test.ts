import { describe, expect, it } from 'bun:test'
import { ITEM_TYPES } from '@raven/core'

import { favouriteSectionsOf } from '@/queries/favouriteCards'
import type { ShowArts } from '@/queries/showArt'
import { homeApi } from '@/test/homeServer'
import { mediaItemFor, summaryFor } from '@/test/mediaItem'

const headersFor = () => ({})

const SEVERANCE = summaryFor({ id: 4, type: ITEM_TYPES.show, title: 'Severance' })
const DUNE = summaryFor({ id: 70, title: 'Dune', year: 2021 })
const LOGO = { uri: 'https://nas.example/logo', headers: {} }
const BACKDROP = { uri: 'https://nas.example/backdrop', headers: {} }

describe('favouriteSectionsOf', () => {
  it('gives a show and a film the title art read for them, and leaves albums and artists without', () => {
    const arts: ShowArts = new Map([
      [SEVERANCE.id, { logo: LOGO, backdrop: null }],
      [DUNE.id, { logo: LOGO, backdrop: null }],
    ])
    const sections = favouriteSectionsOf({
      titles: [SEVERANCE],
      videos: [{ media: mediaItemFor({ id: 50, title: 'Dune', item: DUNE }), poster: DUNE }],
      albums: [],
      artists: [],
      arts,
      api: { ...homeApi(), albumCoverUrl: () => '' },
      headersFor,
    })
    expect(sections.flatMap(({ cards }) => cards.map(({ logo }) => logo))).toEqual([LOGO, LOGO])
  })

  it('leaves a title with no art without a logo, so its card keeps its name', () => {
    const sections = favouriteSectionsOf({
      titles: [SEVERANCE],
      videos: [],
      albums: [],
      artists: [],
      arts: new Map(),
      api: { ...homeApi(), albumCoverUrl: () => '' },
      headersFor,
    })
    expect(sections.flatMap(({ cards }) => cards.map(({ logo }) => logo))).toEqual([null])
  })

  it("lays a favourite episode out as a wide card with its show's logo, name and S1.E1 mark", () => {
    const season = summaryFor({
      id: 5,
      type: ITEM_TYPES.season,
      title: 'Season 5',
      show: { id: 3, title: "The Handmaid's Tale" },
      season: 5,
    })
    const episode = summaryFor({
      id: 6,
      type: ITEM_TYPES.episode,
      title: 'Morning',
      show: { id: 3, title: "The Handmaid's Tale" },
      season: 5,
      episode: 1,
    })
    const sections = favouriteSectionsOf({
      titles: [],
      videos: [{ media: mediaItemFor({ id: 51, item: episode }), poster: season }],
      albums: [],
      artists: [],
      arts: new Map([[3, { logo: LOGO, backdrop: null }]]),
      api: { ...homeApi(), albumCoverUrl: () => '' },
      headersFor,
    })
    expect(sections.map(({ shape }) => shape)).toEqual(['wide'])
    expect(sections[0]?.cards[0] ?? null).toMatchObject({
      logo: LOGO,
      episode: { name: 'Morning', mark: 'S5.E1' },
    })
  })

  it("draws a favourite show and film on their backdrop with their logo, as Continue watching's cards", () => {
    const sections = favouriteSectionsOf({
      titles: [SEVERANCE],
      videos: [{ media: mediaItemFor({ id: 50, title: 'Dune', item: DUNE }), poster: DUNE }],
      albums: [],
      artists: [],
      arts: new Map([
        [SEVERANCE.id, { logo: LOGO, backdrop: BACKDROP }],
        [DUNE.id, { logo: LOGO, backdrop: BACKDROP }],
      ]),
      api: { ...homeApi(), albumCoverUrl: () => '' },
      headersFor,
    })
    expect(sections.map(({ shape }) => shape)).toEqual(['wide'])
    const [show, film] = sections[0]?.cards ?? []
    expect(show).toMatchObject({ picture: BACKDROP, logo: LOGO })
    expect(film?.logo).toEqual(LOGO)
    expect(film?.picture?.uri).toContain('backdrop')
  })

  it('keeps a show with no backdrop as its poster', () => {
    const sections = favouriteSectionsOf({
      titles: [SEVERANCE],
      videos: [],
      albums: [],
      artists: [],
      arts: new Map([[SEVERANCE.id, { logo: LOGO, backdrop: null }]]),
      api: { ...homeApi(), albumCoverUrl: () => '' },
      headersFor,
    })
    expect(sections.map(({ shape }) => shape)).toEqual(['poster'])
  })
})
