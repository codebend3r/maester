import { describe, expect, it } from 'bun:test'
import {
  episodeByline,
  episodeFacts,
  formatAirDate,
  primaryVersion,
  runtimeFact,
} from '@/lib/itemFacts'
import { itemDetails, mediaItem } from '@/test/fixtures'

describe('primaryVersion', () => {
  it('starts from a saved spot, in whichever version holds it', () => {
    const first = mediaItem({ id: 1 })
    const resumed = mediaItem({ id: 2, position: 600 })
    expect(primaryVersion([first, resumed])).toBe(resumed)
  })

  it('falls back to the best version, and to nothing without any', () => {
    const first = mediaItem({ id: 1 })
    expect(primaryVersion([first, mediaItem({ id: 2 })])).toBe(first)
    expect(primaryVersion([])).toBeUndefined()
  })
})

describe('runtimeFact', () => {
  it("prefers the file's own length to TMDB's runtime", () => {
    expect(runtimeFact({ file: mediaItem({ duration: 3600 }), runtime: 97 })).toBe('1h 0m')
    expect(runtimeFact({ file: mediaItem({ duration: null }), runtime: 97 })).toBe('1h 37m')
    expect(runtimeFact({ file: undefined, runtime: null })).toBeNull()
  })
})

describe('episode facts', () => {
  it('names the show, season and episode, then the air date and runtime', () => {
    const details = itemDetails({
      type: 'episode',
      show: { id: 5, title: 'Severance' },
      season: 1,
      episode: 2,
      released: '2022-02-18',
      runtime: 55,
    })
    expect(episodeByline(details)).toBe('Severance · Season 1 · Episode 2')
    expect(episodeFacts({ details, primary: undefined })).toEqual([
      formatAirDate('2022-02-18')!,
      '55m',
    ])
  })
})
