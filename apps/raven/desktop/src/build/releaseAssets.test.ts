import { describe, expect, it } from 'bun:test'
import { join } from 'node:path'
import { NATIVE_TARGETS } from '@raven/mpv'
import {
  madeFilesFor,
  releaseAssetNames,
  sha256Sums,
  SOURCE_BUNDLE,
  sourcesFrom,
} from '@/build/releaseAssets'
import { appAssetNameFor } from '@/main/updates'

describe('releaseAssetNames', () => {
  it('names the four macOS assets without spaces', () => {
    expect(releaseAssetNames({ version: '0.6.0', target: NATIVE_TARGETS.darwinArm64 })).toEqual({
      app: 'raven-player-0.6.0-arm64.dmg',
      zip: 'raven-player-0.6.0-arm64.zip',
      sources: 'raven-player-0.6.0-sources.tar.gz',
      sums: 'SHA256SUMS',
    })
  })

  it('names the four Windows assets without spaces', () => {
    expect(releaseAssetNames({ version: '0.6.0', target: NATIVE_TARGETS.win32X64 })).toEqual({
      app: 'raven-player-0.6.0-x64-setup.exe',
      zip: 'raven-player-0.6.0-x64.zip',
      sources: 'raven-player-0.6.0-sources.tar.gz',
      sums: 'SHA256SUMS',
    })
  })

  it.each(Object.values(NATIVE_TARGETS))(
    'names the %s app as the update check looks for it',
    (target) => {
      expect(releaseAssetNames({ version: '0.6.0', target }).app).toBe(
        appAssetNameFor({ version: '0.6.0', target }),
      )
    },
  )
})

describe('madeFilesFor', () => {
  it('finds the dmg and zip Forge makes on macOS', () => {
    expect(madeFilesFor({ version: '0.6.0', target: NATIVE_TARGETS.darwinArm64 })).toEqual({
      app: join('dmg', 'darwin', 'arm64', 'raven-player-0.6.0-arm64.dmg'),
      zip: join('zip', 'darwin', 'arm64', 'Raven-darwin-arm64-0.6.0.zip'),
    })
  })

  it("finds Squirrel's setup exe and the zip Forge makes on Windows", () => {
    expect(madeFilesFor({ version: '0.6.0', target: NATIVE_TARGETS.win32X64 })).toEqual({
      app: join('squirrel.windows', 'x64', 'Raven-0.6.0 Setup.exe'),
      zip: join('zip', 'win32', 'x64', 'Raven-win32-x64-0.6.0.zip'),
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
