import { describe, expect, it } from 'bun:test'
import type { Saga } from '@/contract'
import { sagaBackdrop } from '@/sagas'
import { itemSummary, mediaItem } from '@/test/fixtures'

const saga = (backdrops: ReadonlyArray<string | null>): Saga => ({
  tmdbId: '119',
  name: 'The Lord of the Rings Collection',
  media: backdrops.map((backdropVersion, index) =>
    mediaItem({ id: index + 1, item: itemSummary({ id: (index + 1) * 10, backdropVersion }) }),
  ),
})

describe('sagaBackdrop', () => {
  it('is the backdrop of the first movie that has one', () => {
    expect(sagaBackdrop(saga([null, 'b2', 'b3']))).toEqual({ id: 20, version: 'b2' })
  })

  it('is null when no movie has one, or a file is matched to none', () => {
    expect(sagaBackdrop(saga([null, null]))).toBeNull()
    expect(sagaBackdrop({ ...saga([]), media: [mediaItem({ item: null })] })).toBeNull()
  })
})
