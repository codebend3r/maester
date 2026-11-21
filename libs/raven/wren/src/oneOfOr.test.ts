import { describe, expect, it } from 'bun:test'

import { LIBRARY_SEGMENTS } from '@/library/segments'
import { oneOfOr } from '@/oneOfOr'

describe('oneOfOr', () => {
  const segmentOf = oneOfOr({
    values: Object.values(LIBRARY_SEGMENTS),
    fallback: LIBRARY_SEGMENTS.albums,
  })

  it('reads a value it knows as itself', () => {
    expect(segmentOf('songs')).toBe(LIBRARY_SEGMENTS.songs)
    expect(segmentOf('downloads')).toBe(LIBRARY_SEGMENTS.downloads)
  })

  it('reads anything else as the fallback', () => {
    expect(segmentOf('films')).toBe(LIBRARY_SEGMENTS.albums)
    expect(segmentOf(undefined)).toBe(LIBRARY_SEGMENTS.albums)
    expect(segmentOf(['songs'])).toBe(LIBRARY_SEGMENTS.albums)
  })
})
