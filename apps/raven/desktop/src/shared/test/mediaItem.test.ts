import { describe, expect, it } from 'bun:test'
import { isMediaItem } from '@raven/core'
import { mediaItemFor } from '@/shared/test/mediaItem'

describe('mediaItemFor', () => {
  it('is a title the server could send', () => {
    expect(isMediaItem(mediaItemFor({}))).toBe(true)
    expect(isMediaItem(mediaItemFor({ id: 8, title: 'Episode 2', duration: null }))).toBe(true)
  })
})
