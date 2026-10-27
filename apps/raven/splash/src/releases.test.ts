import { describe, expect, test } from 'bun:test'

import { fileLabel, formatBytes, formatDate, parseReleases } from '@/releases'

type AssetProps = {
  name: string
  size?: number
}

const asset = ({ name, size = 155_000_000 }: AssetProps) => ({
  name,
  size,
  browser_download_url: `https://example.test/${name}`,
})

const latest = {
  tag_name: 'v0.7.5',
  published_at: '2026-10-26T18:00:00Z',
  assets: [
    asset({ name: 'SHA256SUMS', size: 290 }),
    asset({ name: 'raven-player-0.7.5-sources.tar.gz' }),
    asset({ name: 'raven-player-0.7.5-arm64.zip', size: 139_000_000 }),
    asset({ name: 'raven-player-0.7.5-arm64.dmg' }),
  ],
}

const older = {
  tag_name: 'v0.7.4',
  published_at: '2026-10-20T12:00:00Z',
  assets: [
    asset({ name: 'raven-player-0.7.4-arm64.dmg' }),
    asset({ name: 'raven-player-0.7.4-x64.dmg' }),
  ],
}

describe('parseReleases', () => {
  test('keeps the Raven downloads of each release, in GitHub order', () => {
    expect(parseReleases({ releases: [latest, older] })).toEqual([
      {
        version: '0.7.5',
        date: '2026-10-26T18:00:00Z',
        notesUrl: 'https://github.com/codebend3r/maester/releases/tag/v0.7.5',
        files: [
          {
            arch: 'arm64',
            kind: 'zip',
            url: 'https://example.test/raven-player-0.7.5-arm64.zip',
            bytes: 139_000_000,
          },
          {
            arch: 'arm64',
            kind: 'dmg',
            url: 'https://example.test/raven-player-0.7.5-arm64.dmg',
            bytes: 155_000_000,
          },
        ],
      },
      {
        version: '0.7.4',
        date: '2026-10-20T12:00:00Z',
        notesUrl: 'https://github.com/codebend3r/maester/releases/tag/v0.7.4',
        files: [
          {
            arch: 'arm64',
            kind: 'dmg',
            url: 'https://example.test/raven-player-0.7.4-arm64.dmg',
            bytes: 155_000_000,
          },
          {
            arch: 'x64',
            kind: 'dmg',
            url: 'https://example.test/raven-player-0.7.4-x64.dmg',
            bytes: 155_000_000,
          },
        ],
      },
    ])
  })

  test('leaves out releases with no download, drafts and prereleases', () => {
    const releases = [
      {
        tag_name: 'v0.7.3',
        published_at: '2026-10-01T00:00:00Z',
        assets: [asset({ name: 'SHA256SUMS' })],
      },
      { ...latest, draft: true },
      { ...latest, prerelease: true },
      { tag_name: 'v0.7.2', assets: [] },
      null,
    ]
    expect(parseReleases({ releases })).toEqual([])
  })

  test('answers an empty list for anything that is not a list', () => {
    expect(parseReleases({ releases: null })).toEqual([])
    expect(parseReleases({ releases: { message: 'rate limited' } })).toEqual([])
  })

  test('skips a file of an unknown architecture or kind', () => {
    const release = {
      ...latest,
      assets: [
        asset({ name: 'raven-player-0.7.5-riscv.dmg' }),
        asset({ name: 'raven-player-0.7.5-arm64.pkg' }),
      ],
    }
    expect(parseReleases({ releases: [release] })).toEqual([])
  })
})

describe('labels', () => {
  test('names a file by its architecture and kind', () => {
    expect(fileLabel({ file: { arch: 'arm64', kind: 'dmg', url: '', bytes: 0 } })).toBe(
      'Apple silicon, disk image',
    )
    expect(fileLabel({ file: { arch: 'x64', kind: 'zip', url: '', bytes: 0 } })).toBe(
      'Intel, zip archive',
    )
  })

  test('rounds sizes to megabytes', () => {
    expect(formatBytes({ bytes: 155_400_000 })).toBe('155 MB')
  })

  test('writes dates out in full', () => {
    expect(formatDate({ date: '2026-10-26T18:00:00Z' })).toBe('October 26, 2026')
  })
})
