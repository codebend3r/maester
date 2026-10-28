import { describe, expect, it } from 'bun:test'
import { type Hero, RESOLUTIONS, SESSION_KINDS } from '@raven/core'
import { featuredOf } from '@/pages/HomePage/featured'
import { itemSummary, library, matchedMovie, mediaItem, showEntry } from '@/test/fixtures'

const FILMS = library({ id: 2, name: 'Films' })
const SERIES = library({ id: 3, name: 'Series' })

type ArrivalProps = { id: number; addedAt: string }

/** A movie with both pictures the hero needs, arrived at `addedAt`. */
const arrival = ({ id, addedAt }: ArrivalProps) =>
  matchedMovie({
    id,
    title: `Movie ${id}`,
    addedAt,
    item: itemSummary({
      id: id + 100,
      title: `Movie ${id}`,
      posterVersion: `p${id}`,
      backdropVersion: `b${id}`,
    }),
  })

type ShowProps = { id: number; addedAt: string }

const show = ({ id, addedAt }: ShowProps) =>
  showEntry({
    addedAt,
    show: itemSummary({
      id,
      type: 'show',
      title: `Show ${id}`,
      year: 2022,
      posterVersion: `s${id}`,
      backdropVersion: `d${id}`,
    }),
  })

type MovieEntryProps = {
  media: ReturnType<typeof arrival>
  line?: string | null
}

/** The hero's entry for a movie in Films, with the line the server read for it. */
const movieEntry = ({ media, line = null }: MovieEntryProps): Hero[number] => ({
  libraryId: 2,
  type: 'media',
  media,
  line,
})

type ShowHeroEntryProps = {
  entry: ReturnType<typeof show>
  line?: string | null
}

const showHeroEntry = ({ entry, line = null }: ShowHeroEntryProps): Hero[number] => ({
  libraryId: 3,
  type: 'shows',
  entry,
  line,
})

const LIBRARIES = [FILMS, SERIES]

describe('featuredOf', () => {
  it('keeps the order the server chose, whichever library each title is in', () => {
    const hero = [
      showHeroEntry({ entry: show({ id: 7, addedAt: '2026-10-12T00:00:00.000Z' }) }),
      movieEntry({ media: arrival({ id: 1, addedAt: '2026-10-10T00:00:00.000Z' }) }),
      showHeroEntry({ entry: show({ id: 8, addedAt: '2026-10-11T00:00:00.000Z' }) }),
    ]
    expect(featuredOf({ hero, libraries: LIBRARIES }).map((entry) => entry.title)).toEqual([
      'Show 7',
      'Movie 1',
      'Show 8',
    ])
  })

  it('carries the line the server read under each title', () => {
    const hero = [
      movieEntry({
        media: arrival({ id: 1, addedAt: '2026-10-10T00:00:00.000Z' }),
        line: 'A crew of thieves.',
      }),
    ]
    expect(featuredOf({ hero, libraries: LIBRARIES })[0]?.line).toBe('A crew of thieves.')
  })

  it('leaves out a title whose library is not known, and one with no picture to show', () => {
    const noBackdrop = matchedMovie({ id: 3, item: itemSummary({ backdropVersion: null }) })
    const hero: Hero = [
      {
        libraryId: 99,
        type: 'media',
        media: arrival({ id: 1, addedAt: '2026-10-10T00:00:00.000Z' }),
        line: null,
      },
      { libraryId: 2, type: 'media', media: noBackdrop, line: null },
      { libraryId: 2, type: 'media', media: mediaItem(), line: null },
    ]
    expect(featuredOf({ hero, libraries: LIBRARIES })).toEqual([])
  })

  it("says what a movie is, plays it and opens its page in the movie's library", () => {
    const movie = arrival({ id: 5, addedAt: '2026-10-10T00:00:00.000Z' })
    const hdr = { ...movie, width: 3840, height: 2160, hdr: true, duration: 9960 }
    const [featured] = featuredOf({ hero: [movieEntry({ media: hdr })], libraries: LIBRARIES })
    expect(featured).toMatchObject({
      key: 'media:5',
      poster: '/api/pictures/items/105/poster/p5',
      backdrop: '/api/pictures/items/105/backdrop/b5',
      eyebrow: 'Featured in Films',
      title: 'Movie 5',
      facts: ['2026', '2h 46m'],
      picture: { resolution: RESOLUTIONS.uhd, isHdr: true },
      details: '/movies/105?library=2',
    })
    expect(featured?.play).toEqual({
      to: '/watch/5',
      state: { media: hdr, session: { kind: SESSION_KINDS.single }, upNext: [] },
    })
  })

  it('leaves out the facts a file has not been probed for', () => {
    const movie = arrival({ id: 6, addedAt: '2026-10-10T00:00:00.000Z' })
    const bare = { ...movie, duration: null, width: null, height: null }
    const [featured] = featuredOf({ hero: [movieEntry({ media: bare })], libraries: LIBRARIES })
    expect(featured?.facts).toEqual(['2026'])
    expect(featured?.picture).toBeNull()
  })

  it('says how long a show has run and how much of it there is, and plays what is next', () => {
    const entry = { ...show({ id: 9, addedAt: '2026-10-10T00:00:00.000Z' }), endedYear: 2025 }
    const [featured] = featuredOf({ hero: [showHeroEntry({ entry })], libraries: LIBRARIES })
    expect(featured).toMatchObject({
      key: 'show:9',
      eyebrow: 'Featured in Series',
      title: 'Show 9',
      facts: ['2022 to 2025', '9 episodes'],
      picture: null,
      details: '/shows/9',
    })
    expect(featured?.play?.to).toBe('/watch/12')
  })

  it('has nothing to play for a show watched to the end', () => {
    const entry = { ...show({ id: 9, addedAt: '2026-10-10T00:00:00.000Z' }), next: null }
    expect(
      featuredOf({ hero: [showHeroEntry({ entry })], libraries: LIBRARIES })[0]?.play,
    ).toBeNull()
  })
})
