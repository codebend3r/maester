import { describe, expect, it } from 'bun:test'
import {
  episodeEntryKey,
  mediaEntryKey,
  sagaEntryKey,
  seasonEntryKey,
  showEntryKey,
} from '@/entryKeys'
import { itemSummary, mediaItem } from '@/test/fixtures'

describe('entry keys', () => {
  it('names a file and a show', () => {
    expect(mediaEntryKey(mediaItem({ id: 7 }))).toBe('media:7')
    expect(showEntryKey(itemSummary({ id: 3 }))).toBe('show:3')
  })

  it('names a season, an episode and a saga', () => {
    expect(seasonEntryKey({ id: 12 })).toBe('season:12')
    expect(episodeEntryKey({ id: 13 })).toBe('episode:13')
    expect(sagaEntryKey({ tmdbId: '119' })).toBe('saga:119')
  })
})
