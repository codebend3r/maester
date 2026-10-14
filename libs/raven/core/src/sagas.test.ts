import { describe, expect, it } from 'bun:test'
import { DEFAULT_SAGA_BACKDROP, type Saga, type SagaBackdrop } from '@/contract'
import { sagaBackdrop, sagaPictures } from '@/sagas'
import { itemSummary, mediaItem } from '@/test/fixtures'

const saga = ({
  backdrops,
  backdrop = DEFAULT_SAGA_BACKDROP,
}: {
  backdrops: ReadonlyArray<string | null>
  backdrop?: SagaBackdrop
}): Saga => ({
  tmdbId: '119',
  name: 'The Lord of the Rings Collection',
  backdrop,
  media: backdrops.map((backdropVersion, index) =>
    mediaItem({
      id: index + 1,
      item: itemSummary({ id: (index + 1) * 10, title: `Part ${index + 1}`, backdropVersion }),
    }),
  ),
})

describe('sagaPictures', () => {
  it("is each movie's backdrop, oldest first, passing over the movies with none", () => {
    expect(sagaPictures(saga({ backdrops: ['b1', null, 'b3'] }))).toEqual([
      { id: 10, version: 'b1', title: 'Part 1' },
      { id: 30, version: 'b3', title: 'Part 3' },
    ])
  })

  it('passes over a file matched to none', () => {
    expect(
      sagaPictures({ ...saga({ backdrops: [] }), media: [mediaItem({ item: null })] }),
    ).toEqual([])
  })
})

describe('sagaBackdrop', () => {
  it('is the backdrop of the first movie that has one', () => {
    expect(sagaBackdrop(saga({ backdrops: [null, 'b2', 'b3'] }))).toEqual({
      id: 20,
      version: 'b2',
      title: 'Part 2',
    })
  })

  it('is the movie picked to hold still', () => {
    expect(
      sagaBackdrop(
        saga({ backdrops: ['b1', 'b2', 'b3'], backdrop: { type: 'still', itemId: 30 } }),
      ),
    ).toEqual({ id: 30, version: 'b3', title: 'Part 3' })
  })

  it('falls back to the first once the movie picked has left the saga', () => {
    expect(
      sagaBackdrop(saga({ backdrops: ['b1', 'b2'], backdrop: { type: 'still', itemId: 90 } })),
    ).toEqual({ id: 10, version: 'b1', title: 'Part 1' })
  })

  it('is null when no movie has one, or a file is matched to none', () => {
    expect(sagaBackdrop(saga({ backdrops: [null, null] }))).toBeNull()
    expect(
      sagaBackdrop({ ...saga({ backdrops: [] }), media: [mediaItem({ item: null })] }),
    ).toBeNull()
  })
})
