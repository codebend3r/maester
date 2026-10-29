import { describe, expect, test } from 'bun:test'

import {
  PLATFORMS,
  downloadMenu,
  formatBytes,
  formatDate,
  parseReleases,
  platformList,
  platformOf,
} from '@/releases'
import type { Release } from '@/releases'

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
  tag_name: 'v0.8.0',
  published_at: '2026-10-29T18:00:00Z',
  assets: [
    asset({ name: 'SHA256SUMS', size: 290 }),
    asset({ name: 'raven-player-0.8.0-sources.tar.gz' }),
    asset({ name: 'raven-player-0.8.0-arm64.dmg' }),
    asset({ name: 'raven-player-0.8.0-x64-setup.exe', size: 120_000_000 }),
    asset({ name: 'raven-player-0.8.0-x64.zip', size: 130_000_000 }),
  ],
}

const older = {
  tag_name: 'v0.7.5',
  published_at: '2026-10-26T18:00:00Z',
  assets: [
    asset({ name: 'raven-player-0.7.5-arm64.zip', size: 139_000_000 }),
    asset({ name: 'raven-player-0.7.5-arm64.dmg' }),
  ],
}

const url = (name: string) => `https://example.test/${name}`

describe('parseReleases', () => {
  test('keeps the Raven downloads of each release, in GitHub order', () => {
    expect(parseReleases({ releases: [latest, older] })).toEqual([
      {
        version: '0.8.0',
        date: '2026-10-29T18:00:00Z',
        notesUrl: 'https://github.com/codebend3r/maester/releases/tag/v0.8.0',
        files: [
          {
            platform: PLATFORMS.mac,
            label: 'Mac, disk image',
            url: url('raven-player-0.8.0-arm64.dmg'),
            bytes: 155_000_000,
          },
          {
            platform: PLATFORMS.windows,
            label: 'Windows, installer',
            url: url('raven-player-0.8.0-x64-setup.exe'),
            bytes: 120_000_000,
          },
          {
            platform: PLATFORMS.windows,
            label: 'Windows, zip archive',
            url: url('raven-player-0.8.0-x64.zip'),
            bytes: 130_000_000,
          },
        ],
      },
      {
        version: '0.7.5',
        date: '2026-10-26T18:00:00Z',
        notesUrl: 'https://github.com/codebend3r/maester/releases/tag/v0.7.5',
        files: [
          {
            platform: PLATFORMS.mac,
            label: 'Mac, zip archive',
            url: url('raven-player-0.7.5-arm64.zip'),
            bytes: 139_000_000,
          },
          {
            platform: PLATFORMS.mac,
            label: 'Mac, disk image',
            url: url('raven-player-0.7.5-arm64.dmg'),
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

  test('skips a file the release workflow does not make', () => {
    const release = {
      ...latest,
      assets: [
        asset({ name: 'raven-player-0.8.0-riscv.dmg' }),
        asset({ name: 'raven-player-0.8.0-arm64.pkg' }),
      ],
    }
    expect(parseReleases({ releases: [release] })).toEqual([])
  })
})

const parsed = (release: unknown): Release => {
  const [first] = parseReleases({ releases: [release] })
  if (first === undefined) throw new Error('the release carries no download')
  return first
}

const WINDOWS_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
const MAC_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'

describe('platformOf', () => {
  test('reads Windows from the user agent and offers the Mac app to everyone else', () => {
    expect(platformOf({ userAgent: WINDOWS_AGENT })).toBe(PLATFORMS.windows)
    expect(platformOf({ userAgent: MAC_AGENT })).toBe(PLATFORMS.mac)
    expect(platformOf({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' })).toBe(PLATFORMS.mac)
  })
})

describe('downloadMenu', () => {
  test("names the visitor's platform and lists its files first", () => {
    const menu = downloadMenu({ release: parsed(latest), platform: PLATFORMS.windows })
    expect(menu.title).toBe('Download for Windows')
    expect(menu.files.map((file) => file.label)).toEqual([
      'Windows, installer',
      'Windows, zip archive',
      'Mac, disk image',
    ])
  })

  test('offers the platform a release has when it has nothing for the visitor', () => {
    const menu = downloadMenu({ release: parsed(older), platform: PLATFORMS.windows })
    expect(menu.title).toBe('Download for Mac')
    expect(menu.files).toHaveLength(2)
  })
})

describe('labels', () => {
  test('writes out the computers a release has files for', () => {
    expect(platformList({ release: parsed(latest) })).toBe(
      'Macs with Apple silicon and Windows PCs',
    )
    expect(platformList({ release: parsed(older) })).toBe('Macs with Apple silicon')
  })

  test('rounds sizes to megabytes', () => {
    expect(formatBytes({ bytes: 155_400_000 })).toBe('155 MB')
  })

  test('writes dates out in full', () => {
    expect(formatDate({ date: '2026-10-26T18:00:00Z' })).toBe('October 26, 2026')
  })
})
