import { describe, expect, it } from 'bun:test'
import { AUTH_HEADERS, ITEM_TYPES, movieFacts } from '@raven/core'

import { CARD_SHAPES } from '@/queries/cards'
import { ART_PLACES, playablePage, seasonPage, showPage } from '@/queries/itemPage'
import { ROUTE_TARGETS } from '@/routes'
import { NAS, SERIES } from '@/test/homeServer'
import {
  BUSBOYS,
  BUSBOYS_FILE,
  GOOD_NEWS_ABOUT_HELL,
  SEVERANCE,
  SEVERANCE_ONE,
  itemApi,
} from '@/test/itemServer'
import { mediaItemFor } from '@/test/mediaItem'

const COOKIE = { [AUTH_HEADERS.cookie]: 'raven_unlock=u.1' }
const pictures = { api: itemApi(), headersFor: () => COOKIE }
const at = (path: string) => ({ uri: `${NAS.origin}${path}`, headers: COOKIE })

type MovieProps = { versions?: typeof BUSBOYS.versions }

const movie = ({ versions = [BUSBOYS_FILE] }: MovieProps = {}) =>
  playablePage({
    kind: ITEM_TYPES.movie,
    details: { ...BUSBOYS, versions },
    versions,
    primary: versions[0] ?? BUSBOYS_FILE,
    show: null,
    isShowPending: false,
    tracks: undefined,
    ...pictures,
  })

describe('playablePage', () => {
  it('heads a movie with its poster, backdrop, director and facts, and how much is left', () => {
    const { hero } = movie()
    expect(hero).toEqual({
      eyebrow: null,
      logo: null,
      title: 'Busboys',
      byline: 'Directed by Mark Kimball',
      rating: 'R',
      facts: movieFacts({ details: BUSBOYS, primary: BUSBOYS_FILE }),
      progress: { fraction: 0.5, label: '50 min left' },
      poster: { shape: CARD_SHAPES.poster, picture: at('/api/pictures/items/40/poster/p40') },
      backdrop: at('/api/pictures/items/40/backdrop/b40'),
      tagline: 'Every table has a story.',
      summary: 'Two busboys at a downtown steakhouse plan one last perfect shift.',
    })
  })

  it('says nothing is left of a movie not started', () => {
    const fresh = { ...BUSBOYS_FILE, position: 0 }
    expect(movie({ versions: [fresh] }).hero.progress).toBeNull()
  })

  it('lists the cast once a person, with their photo or initials', () => {
    const page = movie()
    expect(page.castTitle).toBe('Cast & Crew')
    expect(page.cast).toEqual([
      {
        key: '1',
        name: 'Mark Kimball',
        role: 'Rudy / Director',
        initials: 'MK',
        picture: at('/api/pictures/people/1/k1'),
      },
      { key: '2', name: 'Ana Ortiz', role: 'Lena', initials: 'AO', picture: null },
    ])
  })

  it("lists the file's facts, and its versions only once there are two, each playing its own", () => {
    expect(movie().file.map(({ label }) => label)).toEqual([
      'Video',
      'Audio',
      'Container',
      'Bitrate',
      'Size',
    ])
    expect(movie().versions).toEqual([])
    const uhd = mediaItemFor({ ...BUSBOYS_FILE, id: 22, width: 3840, height: 2160, size: 4e10 })
    const rows = movie({ versions: [BUSBOYS_FILE, uhd] }).versions
    expect(rows.map(({ fileName, target }) => [fileName, target])).toEqual([
      ['Busboys (2026).mkv', { kind: ROUTE_TARGETS.play, mediaId: 20, at: 0 }],
      ['Busboys (2026).mkv', { kind: ROUTE_TARGETS.play, mediaId: 22, at: 0 }],
    ])
    expect(rows[1]!.facts).toEqual(['4K', 'HEVC', '40.0 GB'])
  })

  it("heads an episode with its show and number, its still, and the show's backdrop once read", () => {
    const [primary] = GOOD_NEWS_ABOUT_HELL.versions
    if (primary === undefined) throw new Error('the episode has a file')
    type EpisodeProps = {
      show?: typeof SEVERANCE | null
      isShowPending?: boolean
    }

    const episode = ({ show = null, isShowPending = false }: EpisodeProps) =>
      playablePage({
        kind: ITEM_TYPES.episode,
        details: GOOD_NEWS_ABOUT_HELL,
        versions: [primary],
        primary,
        show,
        isShowPending,
        tracks: undefined,
        ...pictures,
      })
    const { hero, castTitle } = episode({ isShowPending: true })
    expect(hero.eyebrow).toBe('Severance · S01 · E01')
    expect(hero.logo).toBeNull()
    expect(episode({ show: { ...SEVERANCE, logoVersion: 'l4' } }).hero).toMatchObject({
      eyebrow: 'S01 · E01',
      logo: { picture: at('/api/pictures/items/4/logo/l4'), place: ART_PLACES.over },
    })
    expect(hero.poster).toEqual({
      shape: CARD_SHAPES.wide,
      picture: at('/api/pictures/items/6/still/s6'),
    })
    expect(hero.backdrop).toBeNull()
    expect(castTitle).toBe('Guest stars & crew')
    expect(episode({ show: SEVERANCE }).hero.backdrop).toEqual(
      at('/api/pictures/items/4/backdrop/b4'),
    )
  })

  it("puts an episode's still behind it once its show is known to have no backdrop, or cannot be read", () => {
    const [primary] = GOOD_NEWS_ABOUT_HELL.versions
    if (primary === undefined) throw new Error('the episode has a file')
    const page = playablePage({
      kind: ITEM_TYPES.episode,
      details: GOOD_NEWS_ABOUT_HELL,
      versions: [primary],
      primary,
      show: null,
      isShowPending: false,
      tracks: undefined,
      ...pictures,
    })
    expect(page.hero.backdrop).toEqual(at('/api/pictures/items/6/still/s6'))
  })
})

describe('showPage', () => {
  it('lists the seasons as posters, each opening its page', () => {
    const page = showPage({ details: SEVERANCE, ...pictures })
    expect(page.hero.eyebrow).toBe('Show')
    expect(page.hero.logo).toBeNull()
    expect(
      showPage({ details: { ...SEVERANCE, logoVersion: 'l4' }, ...pictures }).hero.logo,
    ).toEqual({ picture: at('/api/pictures/items/4/logo/l4'), place: ART_PLACES.title })
    expect(page.seasons).toEqual([
      {
        key: 'season:5',
        title: 'Season 1',
        line: '2 episodes',
        shape: CARD_SHAPES.poster,
        picture: at('/api/pictures/items/5/poster/p5'),
        progress: 0,
        target: { kind: ROUTE_TARGETS.item, itemId: 5, libraryId: null, fileId: null },
      },
      expect.objectContaining({ key: 'season:7', title: 'Season 2' }),
    ])
    expect(page.episodes).toEqual([])
  })
})

describe('seasonPage', () => {
  it('lists the episodes in order, each opening its page in its library', () => {
    const page = seasonPage({ season: SEVERANCE_ONE, show: SEVERANCE, ...pictures })
    expect(page.hero).toMatchObject({
      eyebrow: 'Severance',
      title: 'Season 1',
      facts: ['2022', '2 episodes'],
      progress: { fraction: 0, label: '0 of 2 watched' },
      backdrop: at('/api/pictures/items/4/backdrop/b4'),
    })
    expect(page.episodes.map(({ title, line, target }) => [title, line, target])).toEqual([
      [
        'E1 · Good News About Hell',
        expect.stringContaining('55m'),
        { kind: ROUTE_TARGETS.item, itemId: 6, libraryId: SERIES.id, fileId: null },
      ],
      [
        'E2 · Half Loop',
        expect.stringContaining('55m'),
        { kind: ROUTE_TARGETS.item, itemId: 8, libraryId: SERIES.id, fileId: null },
      ],
    ])
    expect(page.episodes[0]!.picture).toEqual(at('/api/pictures/items/6/still/s6'))
  })

  it('waits for the show for its backdrop', () => {
    expect(seasonPage({ season: SEVERANCE_ONE, show: null, ...pictures }).hero.backdrop).toBeNull()
  })
})
