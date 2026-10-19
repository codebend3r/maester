import { describe, expect, it } from 'bun:test'
import {
  DEFAULT_SAGA_BACKDROP,
  type ItemSummary,
  type Saga,
  type SagaBackdrop,
  WATCH_TARGET_KINDS,
} from '@/contract'
import { sagaCover, sagaFacts, sagaPath, sagaPictures, sagaRuntime, sagaTargets } from '@/sagas'
import { itemSummary, mediaItem } from '@/test/fixtures'

/**
 * A saga whose movie n is file n, matched to item 10n titled "Part n" with
 * `items[n - 1]` laid over it, or to no item where that is null.
 */
const saga = ({
  items,
  durations = [],
  backdrop = DEFAULT_SAGA_BACKDROP,
}: {
  items: ReadonlyArray<Partial<ItemSummary> | null>
  durations?: ReadonlyArray<number | null>
  backdrop?: SagaBackdrop
}): Saga => ({
  tmdbId: '119',
  name: 'The Lord of the Rings Collection',
  backdrop,
  media: items.map((item, index) =>
    mediaItem({
      id: index + 1,
      duration: durations[index] ?? null,
      item: item && itemSummary({ id: (index + 1) * 10, title: `Part ${index + 1}`, ...item }),
    }),
  ),
})

const backdrops = (...versions: ReadonlyArray<string | null>): Partial<ItemSummary>[] =>
  versions.map((backdropVersion) => ({ backdropVersion }))

describe('sagaPictures', () => {
  it("is each movie's backdrop, oldest first, passing over the movies with none", () => {
    expect(sagaPictures(saga({ items: backdrops('b1', null, 'b3') }))).toEqual([
      { id: 10, version: 'b1', title: 'Part 1' },
      { id: 30, version: 'b3', title: 'Part 3' },
    ])
  })

  it('passes over a file matched to none', () => {
    expect(sagaPictures(saga({ items: [null] }))).toEqual([])
  })
})

describe('sagaCover', () => {
  it('is the backdrop of the first movie that has one', () => {
    expect(sagaCover(saga({ items: backdrops(null, 'b2', 'b3') }))).toEqual({
      id: 20,
      version: 'b2',
      title: 'Part 2',
    })
  })

  it('is the movie picked to hold still', () => {
    expect(
      sagaCover(
        saga({ items: backdrops('b1', 'b2', 'b3'), backdrop: { type: 'still', itemId: 30 } }),
      ),
    ).toEqual({ id: 30, version: 'b3', title: 'Part 3' })
  })

  it('falls back to the first once the movie picked has left the saga', () => {
    expect(
      sagaCover(saga({ items: backdrops('b1', 'b2'), backdrop: { type: 'still', itemId: 90 } })),
    ).toEqual({ id: 10, version: 'b1', title: 'Part 1' })
  })

  it('is null when no movie has one, or a file is matched to none', () => {
    expect(sagaCover(saga({ items: backdrops(null, null) }))).toBeNull()
    expect(sagaCover(saga({ items: [null] }))).toBeNull()
  })
})

describe('sagaFacts', () => {
  it('counts the movies and gives the span of their years', () => {
    expect(sagaFacts(saga({ items: [{ year: 2001 }, { year: 2002 }, { year: 2003 }] }))).toEqual([
      '3 movies',
      '2001 to 2003',
    ])
  })

  it('gives one year when they all share it', () => {
    expect(sagaFacts(saga({ items: [{ year: 2001 }, { year: 2001 }] }))).toEqual([
      '2 movies',
      '2001',
    ])
  })

  it('leaves the span out when no movie has a year', () => {
    expect(sagaFacts(saga({ items: [{ year: null }, null] }))).toEqual(['2 movies'])
  })
})

describe('sagaRuntime', () => {
  it('adds the length of each movie shown', () => {
    expect(sagaRuntime(saga({ items: [{}, {}], durations: [3600, 5400] }))).toBe('2h 30m in all')
  })

  it('is null until any of them has been probed', () => {
    expect(sagaRuntime(saga({ items: [{}, {}] }))).toBeNull()
  })
})

describe('sagaPath', () => {
  it("is the saga's page under its library's, the TMDB id encoded", () => {
    expect(sagaPath({ libraryId: 3, saga: saga({ items: [{}] }) })).toBe('/libraries/3/sagas/119')
    expect(sagaPath({ libraryId: 3, saga: { ...saga({ items: [{}] }), tmdbId: 'a b/c' } })).toBe(
      '/libraries/3/sagas/a%20b%2Fc',
    )
  })
})

describe('sagaTargets', () => {
  it("lists each movie's target in order: its item in the library, else its own file", () => {
    expect(sagaTargets({ libraryId: 3, saga: saga({ items: [{}, null, {}] }) })).toEqual([
      { kind: WATCH_TARGET_KINDS.item, id: 10, libraryId: 3 },
      { kind: WATCH_TARGET_KINDS.media, id: 2 },
      { kind: WATCH_TARGET_KINDS.item, id: 30, libraryId: 3 },
    ])
  })
})
