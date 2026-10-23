import { describe, expect, it } from 'bun:test'
import type { HomeShelf, Library } from '@raven/core'
import { FEATURED_COUNT, featuredOf } from '@/pages/HomePage/featured'
import { itemSummary, library, matchedMovie, mediaItem, showEntry } from '@/test/fixtures'

const FILMS = library({ id: 2, name: 'Films' })
const SERIES = library({ id: 3, name: 'Series' })

/** A movie with both pictures the hero needs, arrived at `addedAt`. */
const arrival = ({ id, addedAt }: { id: number; addedAt: string }) =>
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

const show = ({ id, addedAt }: { id: number; addedAt: string }) =>
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

const titles = (shelves: ReadonlyArray<{ shelf: HomeShelf; library: Library }>) =>
  featuredOf(shelves).map((entry) => entry.title)

describe('featuredOf', () => {
  it("takes each library's newest arrival first, the most recent first, then each one's next", () => {
    expect(
      titles([
        {
          library: FILMS,
          shelf: {
            libraryId: 2,
            type: 'media',
            media: [
              arrival({ id: 1, addedAt: '2026-10-10T00:00:00.000Z' }),
              arrival({ id: 2, addedAt: '2026-10-09T00:00:00.000Z' }),
            ],
          },
        },
        {
          library: SERIES,
          shelf: {
            libraryId: 3,
            type: 'shows',
            shows: [
              show({ id: 7, addedAt: '2026-10-12T00:00:00.000Z' }),
              show({ id: 8, addedAt: '2026-10-11T00:00:00.000Z' }),
            ],
          },
        },
      ]),
    ).toEqual(['Show 7', 'Movie 1', 'Show 8', 'Movie 2'])
  })

  it(`stops at ${FEATURED_COUNT}`, () => {
    const media = Array.from({ length: 8 }, (_, index) =>
      arrival({ id: index + 1, addedAt: `2026-10-0${9 - index}T00:00:00.000Z` }),
    )
    expect(titles([{ library: FILMS, shelf: { libraryId: 2, type: 'media', media } }])).toEqual([
      'Movie 1',
      'Movie 2',
      'Movie 3',
      'Movie 4',
      'Movie 5',
    ])
  })

  it('leaves out what has no poster or no backdrop, and files matched to nothing', () => {
    const noBackdrop = matchedMovie({ id: 3, item: itemSummary({ backdropVersion: null }) })
    const noPoster = matchedMovie({
      id: 4,
      item: itemSummary({ posterVersion: null, backdropVersion: 'b4' }),
    })
    const bareShow = showEntry()
    expect(
      featuredOf([
        {
          library: FILMS,
          shelf: { libraryId: 2, type: 'media', media: [noBackdrop, noPoster, mediaItem()] },
        },
        { library: SERIES, shelf: { libraryId: 3, type: 'shows', shows: [bareShow] } },
      ]),
    ).toEqual([])
  })

  it("says what a movie is, plays it and opens its page in the movie's library", () => {
    const movie = arrival({ id: 5, addedAt: '2026-10-10T00:00:00.000Z' })
    const hdr = { ...movie, width: 3840, height: 2160, hdr: true, duration: 9960 }
    const [featured] = featuredOf([
      { library: FILMS, shelf: { libraryId: 2, type: 'media', media: [hdr] } },
    ])
    expect(featured).toMatchObject({
      key: 'media:5',
      itemId: 105,
      poster: '/api/pictures/items/105/poster/p5',
      backdrop: '/api/pictures/items/105/backdrop/b5',
      eyebrow: 'New in Films',
      title: 'Movie 5',
      facts: ['2026', '2h 46m', '4K HDR'],
      details: '/movies/105?library=2',
    })
    expect(featured?.play).toEqual({
      to: '/watch/5',
      state: { media: hdr, upNext: [], isShuffled: false },
    })
  })

  it('leaves out the facts a file has not been probed for', () => {
    const movie = arrival({ id: 6, addedAt: '2026-10-10T00:00:00.000Z' })
    const bare = { ...movie, duration: null, width: null, height: null }
    expect(
      featuredOf([{ library: FILMS, shelf: { libraryId: 2, type: 'media', media: [bare] } }])[0]
        ?.facts,
    ).toEqual(['2026'])
  })

  it('says how long a show has run and how much of it there is, and plays what is next', () => {
    const entry = { ...show({ id: 9, addedAt: '2026-10-10T00:00:00.000Z' }), endedYear: 2025 }
    const [featured] = featuredOf([
      { library: SERIES, shelf: { libraryId: 3, type: 'shows', shows: [entry] } },
    ])
    expect(featured).toMatchObject({
      key: 'show:9',
      eyebrow: 'New in Series',
      title: 'Show 9',
      facts: ['2022 to 2025', '9 episodes'],
      details: '/shows/9',
    })
    expect(featured?.play?.to).toBe('/watch/12')
  })

  it('has nothing to play for a show watched to the end', () => {
    const entry = { ...show({ id: 9, addedAt: '2026-10-10T00:00:00.000Z' }), next: null }
    expect(
      featuredOf([{ library: SERIES, shelf: { libraryId: 3, type: 'shows', shows: [entry] } }])[0]
        ?.play,
    ).toBeNull()
  })
})
