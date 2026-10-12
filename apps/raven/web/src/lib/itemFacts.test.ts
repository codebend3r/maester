import { describe, expect, it } from 'bun:test'
import {
  episodeByline,
  episodeFacts,
  formatAirDate,
  runtimeFact,
  versionFacts,
} from '@/lib/itemFacts'
import { itemDetails, mediaItem } from '@/test/fixtures'

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

describe('versionFacts', () => {
  it("names a file's resolution, HDR, codec and size, leaving out what it does not have", () => {
    expect(
      versionFacts(
        mediaItem({
          width: 3840,
          height: 2160,
          hdr: true,
          videoCodec: 'hevc',
          size: 61_000_000_000,
        }),
      ),
    ).toEqual(['4K', 'HDR', 'HEVC', '61.0 GB'])
    expect(
      versionFacts(mediaItem({ width: null, height: null, videoCodec: null, size: 1_500_000_000 })),
    ).toEqual(['1.5 GB'])
  })
})
