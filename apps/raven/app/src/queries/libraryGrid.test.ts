import { describe, expect, it } from 'bun:test'
import {
  AUTH_HEADERS,
  ITEM_TYPES,
  LIBRARY_KINDS,
  LIBRARY_VIEWS,
  MATCH_STATES,
  MEDIA_GROUPINGS,
  MEDIA_SORTS,
  type LibrarySettings,
} from '@raven/core'

import { CARD_SHAPES } from '@/queries/cards'
import { librarySectionsOf } from '@/queries/libraryGrid'
import { FILMS, NAS, SERIES } from '@/test/homeServer'
import { ASHFALL_GATE, BUSBOYS, NIGHT_TRAIN, libraryApi } from '@/test/libraryServer'
import { mediaItemFor } from '@/test/mediaItem'
import { ROUTE_TARGETS } from '@/routes'

const COOKIE = { [AUTH_HEADERS.cookie]: 'raven_unlock=u.1' }
const NOW = new Date('2026-10-20T00:00:00.000Z')
const pictures = { api: libraryApi(), headersFor: () => COOKIE, now: NOW }

const settingsWith = (change: Partial<LibrarySettings>): LibrarySettings => ({
  ...FILMS.settings,
  ...change,
})

const EPISODE = mediaItemFor({
  id: 70,
  libraryId: SERIES.id,
  title: 'Harbour Lights',
  fileName: 'Harbour Lights - S01E01.mkv',
  folder: 'Harbour Lights/Season 1',
  match: MATCH_STATES.unmatched,
})

describe('librarySectionsOf', () => {
  it('lays a movies library out as one run of posters, each under its year in a title sort', () => {
    const sections = librarySectionsOf({
      settings: FILMS.settings,
      listing: { shows: [], files: [ASHFALL_GATE, BUSBOYS, NIGHT_TRAIN] },
      ...pictures,
    })
    expect(sections).toHaveLength(1)
    const [all] = sections
    expect(all!.title).toBeNull()
    expect(all!.shape).toBe(CARD_SHAPES.poster)
    expect(all!.cards.map(({ title, line }) => [title, line])).toEqual([
      ['Ashfall Gate', '2021'],
      ['Busboys', '2026'],
      ['Night Train', '2025'],
    ])
    expect(all!.cards[1]).toMatchObject({
      key: 'media:31',
      target: { kind: ROUTE_TARGETS.item, itemId: 51, libraryId: FILMS.id, fileId: null },
      picture: { uri: `${NAS.origin}/api/pictures/items/51/poster/p51`, headers: COOKIE },
    })
  })

  it('has each card say the value its listing is sorted by, as the web cards do', () => {
    const [all] = librarySectionsOf({
      settings: settingsWith({ sort: MEDIA_SORTS.added }),
      listing: { shows: [], files: [BUSBOYS] },
      ...pictures,
    })
    expect(all!.cards[0]!.line).toBe('Added 4 days ago')
  })

  it('buckets the grouped view as the web groups it, each bucket with its count', () => {
    const pending = { ...NIGHT_TRAIN, match: MATCH_STATES.unmatched, item: null }
    const sections = librarySectionsOf({
      settings: settingsWith({ view: LIBRARY_VIEWS.grouped, groupBy: MEDIA_GROUPINGS.match }),
      listing: { shows: [], files: [ASHFALL_GATE, BUSBOYS, pending] },
      ...pictures,
    })
    expect(sections.map(({ key, title, count }) => [key, title, count])).toEqual([
      ['group:matched', 'Matched', '2 videos'],
      ['group:unmatched', 'Not matched', '1 video'],
    ])
    expect(sections[1]!.cards.map(({ title }) => title)).toEqual(['Night Train'])
  })

  it('lays a library that is never matched out as frame grabs with their lengths', () => {
    const clip = mediaItemFor({ id: 80, title: 'Pier at dusk', duration: 125 })
    const [all] = librarySectionsOf({
      settings: settingsWith({ kind: LIBRARY_KINDS.other }),
      listing: { shows: [], files: [clip] },
      ...pictures,
    })
    expect(all!.shape).toBe(CARD_SHAPES.wide)
    expect(all!.cards[0]).toMatchObject({
      title: 'Pier at dusk',
      line: '2m',
      picture: { uri: `${NAS.origin}/api/media/80/thumbnail?v=1`, headers: COOKIE },
    })
  })

  it("lays a show library's shows out as one run of posters when every file found its show", () => {
    const sections = librarySectionsOf({
      settings: SERIES.settings,
      listing: {
        shows: [
          {
            show: { ...BUSBOYS.item!, id: 60, title: 'Ashfall', type: ITEM_TYPES.show, year: 2020 },
            episodes: 8,
            seasons: 1,
            totalEpisodes: 8,
            watchedEpisodes: 0,
            endedYear: 2022,
            addedAt: '2026-10-16T00:00:00.000Z',
            bitrate: null,
            next: null,
          },
        ],
        files: [],
      },
      ...pictures,
    })
    expect(sections.map(({ key, title }) => [key, title])).toEqual([['shows', null]])
    expect(sections[0]!.cards[0]).toMatchObject({
      key: 'show:60',
      title: 'Ashfall',
      line: '2020 to 2022',
      target: { kind: ROUTE_TARGETS.item, itemId: 60, libraryId: null, fileId: null },
    })
  })

  it("puts a show library's files no show was found for after its shows, by show folder", () => {
    const second = { ...EPISODE, id: 71, fileName: 'Harbour Lights - S01E02.mkv' }
    const sections = librarySectionsOf({
      settings: SERIES.settings,
      listing: { shows: [], files: [EPISODE, second] },
      ...pictures,
    })
    expect(sections.map(({ key, title, count }) => [key, title, count])).toEqual([
      ['folder:Harbour Lights', 'Harbour Lights', 'Not matched, 2 episodes'],
    ])
    expect(sections[0]!.shape).toBe(CARD_SHAPES.wide)
  })
})
