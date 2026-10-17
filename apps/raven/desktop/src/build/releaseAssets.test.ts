import { describe, expect, it } from 'bun:test'
import { releaseAssetNames, sha256Sums, SOURCE_BUNDLE, sourcesFrom } from '@/build/releaseAssets'

describe('releaseAssetNames', () => {
  it('names the four assets without spaces', () => {
    expect(releaseAssetNames({ version: '0.6.0' })).toEqual({
      dmg: 'raven-player-0.6.0-arm64.dmg',
      zip: 'raven-player-0.6.0-arm64.zip',
      sources: 'raven-player-0.6.0-sources.tar.gz',
      sums: 'SHA256SUMS',
    })
  })
})

describe('sha256Sums', () => {
  it('writes one shasum line per asset, sorted by name', () => {
    expect(
      sha256Sums([
        { name: 'b', sha256: '2' },
        { name: 'a', sha256: '1' },
      ]),
    ).toBe('1  a\n2  b\n')
  })

  it('writes nothing for no assets', () => {
    expect(sha256Sums([])).toBe('')
  })
})

describe('sourcesFrom', () => {
  it('takes the folder after --sources', () => {
    expect(sourcesFrom(['--sources', '/tmp/s'])).toBe('/tmp/s')
  })

  it("falls back to libmpv's source bundle", () => {
    expect(sourcesFrom([])).toBe(SOURCE_BUNDLE)
  })

  it('falls back when --sources has no value', () => {
    expect(sourcesFrom(['--sources'])).toBe(SOURCE_BUNDLE)
  })
})
