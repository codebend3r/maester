import { describe, expect, it } from 'bun:test'
import { letterOf, mediaLetter, showLetter } from '@/lib/letters'
import { itemSummary, mediaItem } from '@/test/fixtures'

describe('letters', () => {
  it('files a title under its first letter, its accent dropped, and the rest under #', () => {
    expect(letterOf('heat')).toBe('H')
    expect(letterOf('Émile')).toBe('E')
    expect(letterOf('28 Days Later')).toBe('#')
    expect(letterOf('#Alive')).toBe('#')
    expect(letterOf('')).toBe('#')
  })

  it("files a matched video under its movie's title without the article, as the sort does", () => {
    expect(mediaLetter(mediaItem({ item: itemSummary({ title: 'The Matrix' }) }))).toBe('M')
    expect(mediaLetter(mediaItem({ title: 'The Making Of', item: null }))).toBe('T')
    expect(showLetter(itemSummary({ title: 'A Knight of the Seven Kingdoms' }))).toBe('K')
  })
})
