import { describe, expect, it } from 'bun:test'
import { QUEUE_SOURCE_KINDS } from '@raven/core'

import { DOWNLOAD_COPY } from '@/downloads/copy'
import {
  DOWNLOAD_STATES,
  type DownloadEntry,
  type DownloadGroup,
  type DownloadLibrary,
  GROUP_KINDS,
  downloadKeyOf,
} from '@/downloads/downloadEntries'
import { FINISHED_KINDS, UNDERWAY_PHASES, downloadsPageOf } from '@/downloads/downloadsPage'
import {
  DONE_STATUS,
  DOWNLOADS_SERVER_ID,
  SEASON_GROUP,
  SERIES_LIBRARY,
  VAULT_LIBRARY,
  downloadKeyFor,
  recordOf,
  trackEntryOf,
  videoEntryOf,
} from '@/test/downloadFixtures'
import { AIRBAG, OK_COMPUTER, PARANOID } from '@/test/musicServer'

describe('downloadsPageOf', () => {
  it('shows the space, the speed, those on their way, and the finished ones grouped, newest first', () => {
    const entries = recordOf([
      videoEntryOf({ id: 2, status: DONE_STATUS, order: 2 }),
      videoEntryOf({ id: 1, status: DONE_STATUS, order: 1 }),
      videoEntryOf({ id: 3, status: { state: DOWNLOAD_STATES.downloading } }),
      trackEntryOf({ track: PARANOID, addedAt: 5 }),
      trackEntryOf({ track: AIRBAG, addedAt: 5 }),
    ])
    const page = downloadsPageOf({
      entries,
      serverId: DOWNLOADS_SERVER_ID,
      isUnlocked: false,
      readings: { [downloadKeyFor(3)]: { bytes: 1_200_000_000, total: 4_000_000_000 } },
      samples: {
        [downloadKeyFor(3)]: { bytes: 1_200_000_000, at: 900, bytesPerSecond: 12_400_000 },
      },
      now: 1000,
      freeBytes: 123_400_000_000,
    })
    expect(page.available).toBe('123.4 GB available')
    expect(page.used).toBe('Downloads use 4.1 GB')
    expect(page.speed).toBe('12.4 MB/s')
    expect(page.underway).toEqual([
      {
        key: downloadKeyFor(3),
        title: 'Episode 3',
        line: 'S01E03',
        status: '30%',
        bytes: '1.2 GB of 4.0 GB',
        fraction: 0.3,
        speed: '12.4 MB/s',
        timeLeft: 'finished in 4m',
        name: 'Lucky',
        logoPath: null,
        artPath: null,
        isMusic: false,
        phase: UNDERWAY_PHASES.coming,
        isQueued: false,
      },
    ])
    const [album, season] = page.finished
    expect(album).toMatchObject({
      kind: FINISHED_KINDS.music,
      title: OK_COMPUTER.title,
      source: { kind: QUEUE_SOURCE_KINDS.album, id: OK_COMPUTER.id },
    })
    expect(album?.kind === FINISHED_KINDS.music && album.tracks.map(({ id }) => id)).toEqual([
      AIRBAG.id,
      PARANOID.id,
    ])
    expect(season).toMatchObject({
      kind: FINISHED_KINDS.video,
      title: 'Lucky · Season 1',
      line: '2 episodes · 4.0 GB',
      artPath: 'downloads/raven/1/art.jpg',
    })
    expect(season?.rows.map(({ mediaId }) => mediaId)).toEqual([1, 2])
    expect(page.finishedByLibrary).toEqual([
      { key: 'other', name: DOWNLOAD_COPY.otherLibrary, icon: null, groups: [album, season] },
    ])
  })

  type PageOfProps = { entries: readonly DownloadEntry[]; isUnlocked?: boolean }

  const pageOf = ({ entries, isUnlocked = false }: PageOfProps) =>
    downloadsPageOf({
      entries: recordOf(entries),
      serverId: DOWNLOADS_SERVER_ID,
      isUnlocked,
      readings: {},
      samples: {},
      now: 0,
      freeBytes: null,
    })

  it('lists the one coming in first, then the queue in its order, then what failed, each in its words', () => {
    const page = pageOf({
      entries: [
        videoEntryOf({
          id: 1,
          status: { state: DOWNLOAD_STATES.queued, preparing: null },
          place: 3,
        }),
        videoEntryOf({
          id: 2,
          status: { state: DOWNLOAD_STATES.queued, preparing: 0.42 },
          place: 1,
        }),
        videoEntryOf({ id: 3, status: { state: DOWNLOAD_STATES.queued, preparing: 1 }, place: 2 }),
        videoEntryOf({
          id: 4,
          status: { state: DOWNLOAD_STATES.failed, message: 'No.' },
          place: 0,
        }),
        videoEntryOf({
          id: 5,
          status: { state: DOWNLOAD_STATES.preparing, progress: 0.5 },
          place: 4,
        }),
      ],
    })
    expect(page.underway.map(({ title, status, isQueued }) => [title, status, isQueued])).toEqual([
      ['Episode 5', 'Preparing on server 50%', false],
      ['Episode 2', 'Queued · Preparing on server 42%', true],
      ['Episode 3', 'Queued · Ready on server', true],
      ['Episode 1', 'Queued', true],
      ['Episode 4', 'No.', false],
    ])
  })

  it('groups the finished ones under their libraries by name, the library-less last under Other', () => {
    const films: DownloadLibrary = { id: 3, name: 'Films', icon: 'film', isLocked: false }
    const movie: DownloadGroup = {
      kind: GROUP_KINDS.movie,
      id: 30,
      title: 'Heat',
      season: null,
      library: films,
    }
    const page = pageOf({
      entries: [
        videoEntryOf({
          id: 1,
          status: DONE_STATUS,
          group: { ...SEASON_GROUP, library: SERIES_LIBRARY },
          addedAt: 3,
        }),
        videoEntryOf({ id: 30, status: DONE_STATUS, group: movie, addedAt: 2 }),
        trackEntryOf({ track: AIRBAG, addedAt: 1 }),
      ],
    })
    expect(
      page.finishedByLibrary.map(({ key, name, icon, groups }) => [
        key,
        name,
        icon,
        groups.map(({ title }) => title),
      ]),
    ).toEqual([
      ['library:3', 'Films', 'film', ['Heat']],
      ['library:7', 'Series', 'tv', ['Lucky · Season 1']],
      ['other', DOWNLOAD_COPY.otherLibrary, null, [OK_COMPUTER.title]],
    ])
  })

  it("hides a locked library's downloads until the unlock is held, but counts their space", () => {
    const entries = [
      videoEntryOf({
        id: 1,
        status: DONE_STATUS,
        group: { ...SEASON_GROUP, library: VAULT_LIBRARY },
      }),
      videoEntryOf({
        id: 2,
        status: { state: DOWNLOAD_STATES.queued, preparing: null },
        group: { ...SEASON_GROUP, library: VAULT_LIBRARY },
      }),
      videoEntryOf({
        id: 3,
        status: DONE_STATUS,
        group: { ...SEASON_GROUP, library: SERIES_LIBRARY },
      }),
    ]
    const locked = pageOf({ entries: entries })
    expect(locked.underway).toEqual([])
    expect(locked.finished.flatMap(({ rows }) => rows.map(({ mediaId }) => mediaId))).toEqual([3])
    expect(locked.used).toBe('Downloads use 4.0 GB')
    const open = pageOf({ entries: entries, isUnlocked: true })
    expect(open.underway.map(({ title }) => title)).toEqual(['Episode 2'])
    expect(open.finished.flatMap(({ rows }) => rows.map(({ mediaId }) => mediaId))).toEqual([1, 3])
  })

  it('leaves out another server, and says nothing of the space where the device cannot', () => {
    const elsewhere = { ...videoEntryOf({ id: 1, status: DONE_STATUS }), serverId: 'other' }
    const page = downloadsPageOf({
      entries: { [downloadKeyOf({ serverId: 'other', mediaId: 1 })]: elsewhere },
      serverId: DOWNLOADS_SERVER_ID,
      isUnlocked: false,
      readings: {},
      samples: {},
      now: 0,
      freeBytes: null,
    })
    expect(page).toMatchObject({ available: null, speed: null, underway: [], finished: [] })
  })
})
