import { describe, expect, it } from 'bun:test'
import { AUTH_REFUSALS, DOWNLOAD_STATUS_KINDS } from '@raven/core'
import {
  DOWNLOADS_FILE,
  EMPTY_DOWNLOADS,
  FAIL_REASONS,
  PAUSE_REASONS,
  advance,
  bytesOf,
  clearOwed,
  clearPending,
  dropOwed,
  entryById,
  entryByMedia,
  fail,
  finish,
  forgetServerPosition,
  isDownloadEntry,
  isPictureFolder,
  PICTURE_EXTENSIONS,
  setLibrary,
  setPictures,
  isDownloadsState,
  isWaitingOnOutage,
  noteWatched,
  notePending,
  owedOf,
  pause,
  pauseEverything,
  pauseUnderWay,
  queue,
  remove,
  removeAll,
  resume,
  sameGroup,
  setAutoDelete,
  setAutoDeleteDefault,
  setSidecars,
  sortDownloads,
  start,
  type DownloadEntry,
  type DownloadsState,
  type Pending,
} from '@/main/downloads/downloadState'
import { entry, id, SERVER_A, SERVER_B, stateOf } from '@/main/test/downloadEntries'

const ID = id(1)

describe('the guards', () => {
  it('names the file', () => {
    expect(DOWNLOADS_FILE).toBe('downloads.json')
  })

  it('accepts the empty state and a full entry', () => {
    expect(isDownloadsState(EMPTY_DOWNLOADS)).toBe(true)
    const full = entry({
      sidecars: [{ trackId: 'external-3', title: 'English', language: 'en' }],
      status: { kind: DOWNLOAD_STATUS_KINDS.paused, bytes: 10, reason: PAUSE_REASONS.viewer },
      pending: { play: true, position: 12, furthest: 30, at: 5, accountId: null },
    })
    expect(isDownloadEntry(full)).toBe(true)
    expect(isDownloadsState(stateOf(full))).toBe(true)
  })

  it('accepts what removed downloads still owe their servers, and refuses an owed item of no server', () => {
    const pending = { play: true, position: 12, furthest: 30, at: 5, accountId: null }
    expect(
      isDownloadsState({ ...EMPTY_DOWNLOADS, owed: [{ serverId: SERVER_A, mediaId: 1, pending }] }),
    ).toBe(true)
    expect(
      isDownloadsState({ ...EMPTY_DOWNLOADS, owed: [{ serverId: 'vhagar', mediaId: 1, pending }] }),
    ).toBe(false)
    expect(EMPTY_DOWNLOADS.owed).toEqual([])
  })

  it('refuses a status kind it does not know', () => {
    expect(isDownloadEntry({ ...entry(), status: { kind: 'stalled', bytes: 1 } })).toBe(false)
    expect(isDownloadsState({ ...EMPTY_DOWNLOADS, version: 4 })).toBe(false)
  })

  it('keeps why a download stopped as a reason, never as the words the page shows', () => {
    const withStatus = (status: unknown) => ({ ...entry(), status })
    expect(
      isDownloadEntry(
        withStatus({
          kind: DOWNLOAD_STATUS_KINDS.paused,
          bytes: 1,
          reason: PAUSE_REASONS.relocked,
        }),
      ),
    ).toBe(true)
    expect(
      isDownloadEntry(
        withStatus({
          kind: DOWNLOAD_STATUS_KINDS.failed,
          bytes: 1,
          reason: FAIL_REASONS.other,
          message: 'x',
        }),
      ),
    ).toBe(true)
    expect(
      isDownloadEntry(withStatus({ kind: DOWNLOAD_STATUS_KINDS.paused, bytes: 1, message: null })),
    ).toBe(false)
    // A reason no version of Raven pauses for.
    expect(
      isDownloadEntry(
        withStatus({ kind: DOWNLOAD_STATUS_KINDS.paused, bytes: 1, reason: 'asleep' }),
      ),
    ).toBe(false)
    expect(
      isDownloadEntry(withStatus({ kind: DOWNLOAD_STATUS_KINDS.failed, bytes: 1, message: 'x' })),
    ).toBe(false)
    expect(
      isDownloadEntry(
        withStatus({
          kind: DOWNLOAD_STATUS_KINDS.failed,
          bytes: 1,
          reason: PAUSE_REASONS.relocked,
          message: '',
        }),
      ),
    ).toBe(false)
  })

  it("takes a library's Watched at only as a whole percentage from 1 to 100, as core's guard does", () => {
    expect(isDownloadEntry(entry({ watchedPercent: 1 }))).toBe(true)
    expect(isDownloadEntry(entry({ watchedPercent: 100 }))).toBe(true)
    expect(isDownloadEntry(entry({ watchedPercent: 0 }))).toBe(false)
    expect(isDownloadEntry(entry({ watchedPercent: 101 }))).toBe(false)
    expect(isDownloadEntry(entry({ watchedPercent: 89.5 }))).toBe(false)
  })

  it('refuses a container or a track id that is not a safe path segment', () => {
    expect(isDownloadEntry(entry({ container: '../x' }))).toBe(false)
    expect(isDownloadEntry(entry({ container: 'MKV' }))).toBe(false)
    expect(isDownloadEntry(entry({ container: 'mkv' }))).toBe(true)
    const withTrack = (trackId: string) =>
      entry({ sidecars: [{ trackId, title: 'English', language: 'en' }] })
    expect(isDownloadEntry(withTrack('embedded-0'))).toBe(false)
    expect(isDownloadEntry(withTrack('external-../x'))).toBe(false)
    expect(isDownloadEntry(withTrack('external-2'))).toBe(true)
  })

  it('refuses a download id that is not opaque', () => {
    expect(isDownloadEntry(entry({ downloadId: 'one' }))).toBe(false)
  })

  it('takes a size only as a whole number of bytes above 0', () => {
    expect(isDownloadEntry(entry({ size: 1 }))).toBe(true)
    expect(isDownloadEntry(entry({ size: Number.MAX_SAFE_INTEGER }))).toBe(true)
    expect(isDownloadEntry(entry({ size: -1 }))).toBe(false)
    expect(isDownloadEntry(entry({ size: 0 }))).toBe(false)
    expect(isDownloadEntry(entry({ size: 1.5 }))).toBe(false)
    expect(isDownloadEntry(entry({ size: Number.MAX_SAFE_INTEGER + 1 }))).toBe(false)
  })
})

describe('the library and pictures an entry keeps', () => {
  const library = { id: 3, name: 'Movies', isPrivate: true }
  const art = { id: id(7), folder: 'item-12', extension: PICTURE_EXTENSIONS.jpg } as const
  const logo = { id: id(8), folder: 'item-12', extension: PICTURE_EXTENSIONS.png } as const

  it('accepts an entry with or without them, as a file from before has none', () => {
    expect(isDownloadEntry(entry())).toBe(true)
    expect(
      isDownloadEntry({
        ...entry(),
        library,
        titleItemId: 12,
        pictures: { art, logo, isComplete: true },
      }),
    ).toBe(true)
    expect(
      isDownloadEntry({
        ...entry(),
        titleItemId: null,
        pictures: { art: null, logo: null, isComplete: false },
      }),
    ).toBe(true)
  })

  it('refuses a picture whose folder, id or extension could name another path', () => {
    const withArt = (changed: object) =>
      isDownloadEntry({
        ...entry(),
        pictures: { art: { ...art, ...changed }, logo: null, isComplete: true },
      })
    expect(withArt({})).toBe(true)
    expect(withArt({ folder: '../11' })).toBe(false)
    expect(withArt({ folder: 'item-12/x' })).toBe(false)
    expect(withArt({ folder: 'album-07' })).toBe(false)
    expect(withArt({ id: 'poster' })).toBe(false)
    expect(withArt({ extension: 'svg' })).toBe(false)
    expect(isDownloadEntry({ ...entry(), pictures: { art, logo: null } })).toBe(false)
    expect(isDownloadEntry({ ...entry(), library: { id: 3, name: 'Movies' } })).toBe(false)
    expect(isDownloadEntry({ ...entry(), titleItemId: 0 })).toBe(false)
    expect(isPictureFolder('item-12')).toBe(true)
    expect(isPictureFolder('album-7')).toBe(true)
    expect(isPictureFolder(12)).toBe(false)
  })

  it('files an entry under its library and its title, and no entry for an unknown id', () => {
    const state = stateOf(entry())
    const filed = setLibrary({ state, downloadId: ID, library, titleItemId: 12 })
    expect(entryById({ state: filed, downloadId: ID })).toMatchObject({ library, titleItemId: 12 })
    expect(setLibrary({ state, downloadId: id(9), library, titleItemId: 12 })).toBe(state)
  })

  it("sets a title's pictures on each of its entries and leaves the rest", () => {
    const state = stateOf(
      entry(),
      entry({ downloadId: id(2), mediaId: 2 }),
      entry({ downloadId: id(3), mediaId: 3 }),
    )
    const pictures = { art, logo, isComplete: true }
    const kept = setPictures({ state, downloadIds: [ID, id(2)], pictures })
    expect(kept.entries.map((each) => each.pictures)).toEqual([pictures, pictures, undefined])
    expect(setPictures({ state, downloadIds: [], pictures })).toBe(state)
  })
})

describe('lookups', () => {
  const state = stateOf(entry(), entry({ downloadId: id(2), serverId: SERVER_B, mediaId: 2 }))

  it('finds by download id, or null', () => {
    expect(entryById({ state, downloadId: id(2) })?.mediaId).toBe(2)
    expect(entryById({ state, downloadId: id(9) })).toBeNull()
  })

  it('finds by server and media, or null', () => {
    expect(entryByMedia({ state, serverId: SERVER_B, mediaId: 2 })?.downloadId).toBe(id(2))
    expect(entryByMedia({ state, serverId: SERVER_A, mediaId: 2 })).toBeNull()
  })
})

describe('queue', () => {
  it('appends in order', () => {
    const one = entry({ downloadId: id(1), mediaId: 1 })
    const two = entry({ downloadId: id(2), mediaId: 2 })
    expect(queue({ state: EMPTY_DOWNLOADS, entries: [one, two] }).entries).toEqual([one, two])
  })

  it('skips a server and media already there, and repeats inside the batch', () => {
    const one = entry({ downloadId: id(1), mediaId: 1 })
    const again = entry({ downloadId: id(2), mediaId: 1 })
    const other = entry({ downloadId: id(3), mediaId: 1, serverId: SERVER_B })
    const next = queue({
      state: stateOf(one),
      entries: [again, other, { ...other, downloadId: id(4) }],
    })
    expect(next.entries.map((each) => each.downloadId)).toEqual([id(1), id(3)])
  })

  it('returns the same state when nothing is new', () => {
    const state = stateOf(entry())
    expect(queue({ state, entries: [entry({ downloadId: id(2) })] })).toBe(state)
    expect(queue({ state, entries: [] })).toBe(state)
  })
})

describe('start', () => {
  it('moves a queued entry to downloading at 0 bytes', () => {
    const next = start({
      state: stateOf(entry({ status: { kind: DOWNLOAD_STATUS_KINDS.queued } })),
      downloadId: ID,
    })
    expect(next.entries[0]?.status).toEqual({ kind: DOWNLOAD_STATUS_KINDS.downloading, bytes: 0 })
  })

  // A run that began for a queued file must not undo a pause or a failure that came meanwhile.
  it.each([
    ['paused', { kind: DOWNLOAD_STATUS_KINDS.paused, bytes: 40, reason: PAUSE_REASONS.noSpace }],
    [
      'failed',
      {
        kind: DOWNLOAD_STATUS_KINDS.failed,
        bytes: 70,
        reason: FAIL_REASONS.other,
        message: 'boom',
      },
    ],
    ['ready', { kind: DOWNLOAD_STATUS_KINDS.ready }],
    ['downloading', { kind: DOWNLOAD_STATUS_KINDS.downloading, bytes: 5 }],
  ])('refuses %s with the same state', (_name, status) => {
    const state = stateOf(entry({ status }))
    expect(start({ state, downloadId: ID })).toBe(state)
  })
})

describe('advance', () => {
  it('moves the bytes of a downloading entry', () => {
    const state = stateOf(entry({ status: { kind: DOWNLOAD_STATUS_KINDS.downloading, bytes: 5 } }))
    expect(advance({ state, downloadId: ID, bytes: 50 }).entries[0]?.status).toEqual({
      kind: DOWNLOAD_STATUS_KINDS.downloading,
      bytes: 50,
    })
  })

  it('refuses any other status with the same state', () => {
    const state = stateOf(
      entry({
        status: { kind: DOWNLOAD_STATUS_KINDS.paused, bytes: 5, reason: PAUSE_REASONS.viewer },
      }),
    )
    expect(advance({ state, downloadId: ID, bytes: 50 })).toBe(state)
  })

  it('returns the same state for the bytes it already has', () => {
    const state = stateOf(entry({ status: { kind: DOWNLOAD_STATUS_KINDS.downloading, bytes: 5 } }))
    expect(advance({ state, downloadId: ID, bytes: 5 })).toBe(state)
  })
})

describe('pause', () => {
  it('keeps the bytes and the reason', () => {
    const state = stateOf(entry({ status: { kind: DOWNLOAD_STATUS_KINDS.downloading, bytes: 30 } }))
    expect(
      pause({ state, downloadId: ID, reason: PAUSE_REASONS.unreachable }).entries[0]?.status,
    ).toEqual({
      kind: DOWNLOAD_STATUS_KINDS.paused,
      bytes: 30,
      reason: PAUSE_REASONS.unreachable,
    })
  })

  it('pauses a queued entry at zero bytes, for the viewer', () => {
    expect(
      pause({ state: stateOf(entry()), downloadId: ID, reason: PAUSE_REASONS.viewer }).entries[0]
        ?.status,
    ).toEqual({ kind: DOWNLOAD_STATUS_KINDS.paused, bytes: 0, reason: PAUSE_REASONS.viewer })
  })

  it('refuses a ready entry with the same state', () => {
    const state = stateOf(entry({ status: { kind: DOWNLOAD_STATUS_KINDS.ready } }))
    expect(pause({ state, downloadId: ID, reason: PAUSE_REASONS.viewer })).toBe(state)
  })
})

describe('pauseUnderWay', () => {
  it('pauses only the queued and downloading entries', () => {
    const state = stateOf(
      entry({ downloadId: id(1), mediaId: 1, status: { kind: DOWNLOAD_STATUS_KINDS.queued } }),
      entry({
        downloadId: id(2),
        mediaId: 2,
        status: { kind: DOWNLOAD_STATUS_KINDS.downloading, bytes: 9 },
      }),
      entry({ downloadId: id(3), mediaId: 3, status: { kind: DOWNLOAD_STATUS_KINDS.ready } }),
      entry({
        downloadId: id(4),
        mediaId: 4,
        status: {
          kind: DOWNLOAD_STATUS_KINDS.failed,
          bytes: 1,
          reason: FAIL_REASONS.other,
          message: 'x',
        },
      }),
    )
    const next = pauseUnderWay({ state, reason: PAUSE_REASONS.relocked })
    expect(next.entries.map((each) => each.status)).toEqual([
      { kind: DOWNLOAD_STATUS_KINDS.paused, bytes: 0, reason: PAUSE_REASONS.relocked },
      { kind: DOWNLOAD_STATUS_KINDS.paused, bytes: 9, reason: PAUSE_REASONS.relocked },
      { kind: DOWNLOAD_STATUS_KINDS.ready },
      { kind: DOWNLOAD_STATUS_KINDS.failed, bytes: 1, reason: FAIL_REASONS.other, message: 'x' },
    ])
  })

  it('returns the same state when nothing is touched', () => {
    const state = stateOf(entry({ status: { kind: DOWNLOAD_STATUS_KINDS.ready } }))
    expect(pauseUnderWay({ state, reason: PAUSE_REASONS.viewer })).toBe(state)
  })
})

describe('pauseEverything', () => {
  it('pauses what runs or waits, and what waits on an outage, for the viewer', () => {
    const state = stateOf(
      entry({ downloadId: id(1), mediaId: 1, status: { kind: DOWNLOAD_STATUS_KINDS.queued } }),
      entry({
        downloadId: id(2),
        mediaId: 2,
        status: { kind: DOWNLOAD_STATUS_KINDS.downloading, bytes: 9 },
      }),
      entry({
        downloadId: id(3),
        mediaId: 3,
        status: { kind: DOWNLOAD_STATUS_KINDS.paused, bytes: 4, reason: PAUSE_REASONS.unreachable },
      }),
      entry({
        downloadId: id(4),
        mediaId: 4,
        status: { kind: DOWNLOAD_STATUS_KINDS.failed, bytes: 5, reason: FAIL_REASONS.unreachable },
      }),
      entry({
        downloadId: id(5),
        mediaId: 5,
        status: { kind: DOWNLOAD_STATUS_KINDS.paused, bytes: 6, reason: PAUSE_REASONS.relocked },
      }),
      entry({
        downloadId: id(6),
        mediaId: 6,
        status: { kind: DOWNLOAD_STATUS_KINDS.failed, bytes: 7, reason: FAIL_REASONS.changed },
      }),
      entry({ downloadId: id(7), mediaId: 7, status: { kind: DOWNLOAD_STATUS_KINDS.ready } }),
    )
    expect(pauseEverything(state).entries.map((each) => each.status)).toEqual([
      { kind: DOWNLOAD_STATUS_KINDS.paused, bytes: 0, reason: PAUSE_REASONS.viewer },
      { kind: DOWNLOAD_STATUS_KINDS.paused, bytes: 9, reason: PAUSE_REASONS.viewer },
      { kind: DOWNLOAD_STATUS_KINDS.paused, bytes: 4, reason: PAUSE_REASONS.viewer },
      { kind: DOWNLOAD_STATUS_KINDS.paused, bytes: 5, reason: PAUSE_REASONS.viewer },
      { kind: DOWNLOAD_STATUS_KINDS.paused, bytes: 6, reason: PAUSE_REASONS.relocked },
      { kind: DOWNLOAD_STATUS_KINDS.failed, bytes: 7, reason: FAIL_REASONS.changed },
      { kind: DOWNLOAD_STATUS_KINDS.ready },
    ])
  })

  it('returns the same state when nothing is touched', () => {
    const state = stateOf(
      entry({
        status: { kind: DOWNLOAD_STATUS_KINDS.paused, bytes: 1, reason: PAUSE_REASONS.viewer },
      }),
    )
    expect(pauseEverything(state)).toBe(state)
  })
})

describe('isWaitingOnOutage', () => {
  it('is true for a file paused or failed for an outage, and no other', () => {
    const of = (status: DownloadEntry['status']) => isWaitingOnOutage(entry({ status }))
    expect(
      of({ kind: DOWNLOAD_STATUS_KINDS.paused, bytes: 0, reason: PAUSE_REASONS.unreachable }),
    ).toBe(true)
    expect(
      of({ kind: DOWNLOAD_STATUS_KINDS.failed, bytes: 0, reason: FAIL_REASONS.unreachable }),
    ).toBe(true)
    expect(of({ kind: DOWNLOAD_STATUS_KINDS.paused, bytes: 0, reason: PAUSE_REASONS.viewer })).toBe(
      false,
    )
    expect(of({ kind: DOWNLOAD_STATUS_KINDS.failed, bytes: 0, reason: FAIL_REASONS.gone })).toBe(
      false,
    )
    expect(of({ kind: DOWNLOAD_STATUS_KINDS.queued })).toBe(false)
  })
})

describe('resume', () => {
  it.each([
    ['paused', { kind: DOWNLOAD_STATUS_KINDS.paused, bytes: 3, reason: PAUSE_REASONS.viewer }],
    [
      'failed',
      { kind: DOWNLOAD_STATUS_KINDS.failed, bytes: 3, reason: FAIL_REASONS.other, message: 'x' },
    ],
  ])('makes %s queued', (_name, status) => {
    expect(
      resume({ state: stateOf(entry({ status })), downloadId: ID }).entries[0]?.status,
    ).toEqual({
      kind: DOWNLOAD_STATUS_KINDS.queued,
    })
  })

  it('refuses a downloading entry with the same state', () => {
    const state = stateOf(entry({ status: { kind: DOWNLOAD_STATUS_KINDS.downloading, bytes: 3 } }))
    expect(resume({ state, downloadId: ID })).toBe(state)
  })
})

describe('fail and finish', () => {
  it('fail keeps the bytes, the reason and the words of an other failure', () => {
    const state = stateOf(entry({ status: { kind: DOWNLOAD_STATUS_KINDS.downloading, bytes: 12 } }))
    expect(
      fail({ state, downloadId: ID, failure: { reason: FAIL_REASONS.other, message: 'write EIO' } })
        .entries[0]?.status,
    ).toEqual({
      kind: DOWNLOAD_STATUS_KINDS.failed,
      bytes: 12,
      reason: FAIL_REASONS.other,
      message: 'write EIO',
    })
  })

  it('fail keeps no words for a reason that says it all', () => {
    const state = stateOf(entry({ status: { kind: DOWNLOAD_STATUS_KINDS.downloading, bytes: 12 } }))
    expect(
      fail({ state, downloadId: ID, failure: { reason: FAIL_REASONS.noSpace } }).entries[0]?.status,
    ).toEqual({
      kind: DOWNLOAD_STATUS_KINDS.failed,
      bytes: 12,
      reason: FAIL_REASONS.noSpace,
    })
  })

  it('fail keeps why the server refused the account', () => {
    const state = stateOf(entry({ status: { kind: DOWNLOAD_STATUS_KINDS.downloading, bytes: 12 } }))
    const failure = { reason: FAIL_REASONS.account, refusal: AUTH_REFUSALS.revoked } as const
    expect(fail({ state, downloadId: ID, failure }).entries[0]?.status).toEqual({
      kind: DOWNLOAD_STATUS_KINDS.failed,
      bytes: 12,
      ...failure,
    })
  })

  it('finish makes the entry ready', () => {
    const state = stateOf(
      entry({ status: { kind: DOWNLOAD_STATUS_KINDS.downloading, bytes: 1000 } }),
    )
    expect(finish({ state, downloadId: ID }).entries[0]?.status).toEqual({
      kind: DOWNLOAD_STATUS_KINDS.ready,
    })
  })

  it('a ready entry stays as it is', () => {
    const state = stateOf(entry({ status: { kind: DOWNLOAD_STATUS_KINDS.ready } }))
    expect(fail({ state, downloadId: ID, failure: { reason: FAIL_REASONS.changed } })).toBe(state)
    expect(finish({ state, downloadId: ID })).toBe(state)
  })
})

describe('remove and removeAll', () => {
  const state = stateOf(
    entry({ downloadId: id(1), mediaId: 1 }),
    entry({ downloadId: id(2), mediaId: 2, serverId: SERVER_B }),
  )

  it('remove drops one entry', () => {
    expect(remove({ state, downloadId: id(1) }).entries.map((each) => each.downloadId)).toEqual([
      id(2),
    ])
  })

  it('removeAll drops every entry and keeps the default', () => {
    const next = removeAll({ ...state, autoDeleteDefault: true })
    expect(next.entries).toEqual([])
    expect(next.autoDeleteDefault).toBe(true)
  })

  it('removeAll of nothing returns the same state', () => {
    expect(removeAll(EMPTY_DOWNLOADS)).toBe(EMPTY_DOWNLOADS)
  })
})

describe('what a removed download owes its server', () => {
  const PLAYED: Pending = { play: true, position: 180, furthest: 190, at: 50, accountId: null }
  const owing = stateOf(
    entry({ downloadId: id(1), mediaId: 1, pending: PLAYED }),
    entry({ downloadId: id(2), mediaId: 2, serverId: SERVER_B, pending: PLAYED }),
    entry({ downloadId: id(3), mediaId: 3 }),
  )

  it('remove moves the pending of the entry it drops into owed', () => {
    const next = remove({ state: owing, downloadId: id(1) })
    expect(next.entries.map((each) => each.downloadId)).toEqual([id(2), id(3)])
    expect(next.owed).toEqual([{ serverId: SERVER_A, mediaId: 1, pending: PLAYED }])
  })

  it('remove of an entry with nothing pending owes nothing', () => {
    expect(remove({ state: owing, downloadId: id(3) }).owed).toEqual([])
  })

  it('removeAll moves every pending into owed', () => {
    expect(removeAll(owing).owed).toEqual([
      { serverId: SERVER_A, mediaId: 1, pending: PLAYED },
      { serverId: SERVER_B, mediaId: 2, pending: PLAYED },
    ])
  })

  it('folds a title already owed into one item: the play kept, the newer position, the furthest', () => {
    const first = remove({ state: owing, downloadId: id(1) })
    const again = queue({
      state: first,
      entries: [
        entry({
          downloadId: id(4),
          mediaId: 1,
          pending: { play: false, position: 20, furthest: 40, at: 90, accountId: null },
        }),
      ],
    })
    expect(remove({ state: again, downloadId: id(4) }).owed).toEqual([
      {
        serverId: SERVER_A,
        mediaId: 1,
        pending: { play: true, position: 20, furthest: 190, at: 90, accountId: null },
      },
    ])
  })

  it('folds a title owed a high position with no furthest so the furthest is not below the position', () => {
    const first = remove({
      state: stateOf(
        entry({
          downloadId: id(1),
          mediaId: 1,
          pending: { play: false, position: 180, furthest: null, at: 50, accountId: null },
        }),
      ),
      downloadId: id(1),
    })
    const again = queue({
      state: first,
      entries: [
        entry({
          downloadId: id(4),
          mediaId: 1,
          pending: { play: false, position: null, furthest: 40, at: 90, accountId: null },
        }),
      ],
    })
    expect(remove({ state: again, downloadId: id(4) }).owed).toEqual([
      {
        serverId: SERVER_A,
        mediaId: 1,
        pending: { play: false, position: 180, furthest: 180, at: 90, accountId: null },
      },
    ])
  })

  it('folds a title whose furthest already reaches the position without changing it', () => {
    const first = remove({ state: owing, downloadId: id(1) })
    const again = queue({
      state: first,
      entries: [
        entry({
          downloadId: id(4),
          mediaId: 1,
          pending: { play: false, position: 185, furthest: null, at: 90, accountId: null },
        }),
      ],
    })
    expect(remove({ state: again, downloadId: id(4) }).owed).toEqual([
      {
        serverId: SERVER_A,
        mediaId: 1,
        pending: { play: true, position: 185, furthest: 190, at: 90, accountId: null },
      },
    ])
  })

  it('owedOf finds an owed item by server and media, or null', () => {
    const owed = remove({ state: owing, downloadId: id(1) })
    expect(
      owedOf({ state: owed, serverId: SERVER_A, mediaId: 1, accountId: null })?.pending ?? null,
    ).toEqual(PLAYED)
    expect(owedOf({ state: owed, serverId: SERVER_B, mediaId: 1, accountId: null })).toBeNull()
  })

  it('clearOwed clears what was sent, and drops the item once nothing is left', () => {
    const owed = remove({ state: owing, downloadId: id(1) })
    const key = { serverId: SERVER_A, mediaId: 1, accountId: null }
    const played = clearOwed({
      state: owed,
      ...key,
      sentPlay: true,
      sentPosition: null,
      sentFurthest: null,
    })
    expect(owedOf({ state: played, ...key })?.pending).toEqual({ ...PLAYED, play: false })
    const furthest = clearOwed({
      state: played,
      ...key,
      sentPlay: false,
      sentPosition: null,
      sentFurthest: 190,
    })
    expect(owedOf({ state: furthest, ...key })?.pending).toEqual({
      ...PLAYED,
      play: false,
      furthest: null,
    })
    expect(
      clearOwed({ state: furthest, ...key, sentPlay: false, sentPosition: 180, sentFurthest: 180 })
        .owed,
    ).toEqual([])
  })

  it('clearOwed keeps a position other than the one sent, and changes nothing for an item not owed', () => {
    const owed = remove({ state: owing, downloadId: id(1) })
    const key = { serverId: SERVER_A, mediaId: 1, accountId: null }
    const next = clearOwed({
      state: owed,
      ...key,
      sentPlay: true,
      sentPosition: 100,
      sentFurthest: 190,
    })
    expect(owedOf({ state: next, ...key })?.pending).toEqual({
      play: false,
      position: 180,
      furthest: null,
      at: 50,
      accountId: null,
    })
    expect(
      clearOwed({
        state: owed,
        serverId: SERVER_B,
        mediaId: 1,
        accountId: null,
        sentPlay: true,
        sentPosition: 180,
        sentFurthest: 190,
      }),
    ).toBe(owed)
  })

  it('dropOwed drops one item, and changes nothing for an item not owed', () => {
    const owed = removeAll(owing)
    expect(dropOwed({ state: owed, serverId: SERVER_A, mediaId: 1, accountId: null }).owed).toEqual(
      [{ serverId: SERVER_B, mediaId: 2, pending: PLAYED }],
    )
    expect(dropOwed({ state: owed, serverId: SERVER_A, mediaId: 2, accountId: null })).toBe(owed)
  })
})

describe('setSidecars', () => {
  const sidecars = [{ trackId: 'external-0', title: 'English', language: 'en' }]

  it('sets the subtitles kept beside the video', () => {
    expect(
      setSidecars({ state: stateOf(entry()), downloadId: ID, sidecars }).entries[0]?.sidecars,
    ).toEqual(sidecars)
  })

  it('returns the same state for no subtitles where there were none', () => {
    const state = stateOf(entry())
    expect(setSidecars({ state, downloadId: ID, sidecars: [] })).toBe(state)
  })
})

describe('auto-delete', () => {
  it('setAutoDelete sets one entry', () => {
    const next = setAutoDelete({
      state: stateOf(entry()),
      downloadId: ID,
      autoDelete: true,
      at: 500,
    })
    expect(next.entries[0]?.autoDelete).toBe(true)
  })

  it('setAutoDelete to the same value returns the same state', () => {
    const state = stateOf(entry({ autoDelete: true, watchedAt: 100 }))
    expect(setAutoDelete({ state, downloadId: ID, autoDelete: true, at: 500 })).toBe(state)
  })

  it('setAutoDelete moves an older watchedAt up to the switch when it is turned on', () => {
    const next = setAutoDelete({
      state: stateOf(entry({ watchedAt: 100 })),
      downloadId: ID,
      autoDelete: true,
      at: 500,
    })
    expect(next.entries[0]).toMatchObject({ autoDelete: true, watchedAt: 500 })
  })

  it('setAutoDelete leaves watchedAt when turned off, and a title not watched unwatched', () => {
    const off = setAutoDelete({
      state: stateOf(entry({ autoDelete: true, watchedAt: 100 })),
      downloadId: ID,
      autoDelete: false,
      at: 500,
    })
    expect(off.entries[0]).toMatchObject({ autoDelete: false, watchedAt: 100 })
    const unwatched = setAutoDelete({
      state: stateOf(entry()),
      downloadId: ID,
      autoDelete: true,
      at: 500,
    })
    expect(unwatched.entries[0]?.watchedAt).toBeNull()
  })

  it('setAutoDeleteDefault sets the default, and the same value changes nothing', () => {
    const on = setAutoDeleteDefault({ state: EMPTY_DOWNLOADS, autoDelete: true })
    expect(on.autoDeleteDefault).toBe(true)
    expect(setAutoDeleteDefault({ state: on, autoDelete: true })).toBe(on)
  })
})

describe('noteWatched', () => {
  const watch = (state: DownloadsState, position: number, duration: number | null = 200) =>
    noteWatched({ state, downloadId: ID, position, duration, at: 777 })

  it('sets watchedAt once the position reaches the percent', () => {
    expect(watch(stateOf(entry()), 180).entries[0]?.watchedAt).toBe(777)
  })

  it('does nothing before the percent', () => {
    const state = stateOf(entry())
    expect(watch(state, 179)).toBe(state)
  })

  it('keeps an earlier watchedAt', () => {
    const state = stateOf(entry({ watchedAt: 5 }))
    expect(watch(state, 200)).toBe(state)
  })

  it('uses the entry duration when the request has none', () => {
    expect(watch(stateOf(entry({ duration: 100 })), 90, null).entries[0]?.watchedAt).toBe(777)
  })

  it('sets nothing when both durations are null', () => {
    const state = stateOf(entry({ duration: null }))
    expect(watch(state, 500, null)).toBe(state)
  })

  it('prefers the request duration over the entry one', () => {
    const state = stateOf(entry({ duration: 100 }))
    expect(watch(state, 90, 1000)).toBe(state)
  })
})

describe('pending', () => {
  it('notePending records what the server has not heard', () => {
    const next = notePending({
      state: stateOf(entry()),
      downloadId: ID,
      play: true,
      position: 42,
      at: 9,
      accountId: null,
    })
    expect(next.entries[0]?.pending ?? null).toEqual({
      play: true,
      position: 42,
      furthest: 42,
      at: 9,
      accountId: null,
    })
  })

  it('notePending keeps the furthest position through a scrub back, and raises it past', () => {
    const watched = notePending({
      state: stateOf(entry()),
      downloadId: ID,
      play: true,
      position: 190,
      at: 1,
      accountId: null,
    })
    const back = notePending({
      state: watched,
      downloadId: ID,
      play: false,
      position: 140,
      at: 2,
      accountId: null,
    })
    expect(back.entries[0]?.pending ?? null).toEqual({
      play: true,
      position: 140,
      furthest: 190,
      at: 2,
      accountId: null,
    })
    const past = notePending({
      state: back,
      downloadId: ID,
      play: false,
      position: 195,
      at: 3,
      accountId: null,
    })
    expect(past.entries[0]?.pending ?? null).toEqual({
      play: true,
      position: 195,
      furthest: 195,
      at: 3,
      accountId: null,
    })
  })

  it('notePending keeps a play the server has not heard when a position report follows', () => {
    const played = notePending({
      state: stateOf(entry()),
      downloadId: ID,
      play: true,
      position: 10,
      at: 1,
      accountId: null,
    })
    const next = notePending({
      state: played,
      downloadId: ID,
      play: false,
      position: 20,
      at: 2,
      accountId: null,
    })
    expect(next.entries[0]?.pending ?? null).toEqual({
      play: true,
      position: 20,
      furthest: 20,
      at: 2,
      accountId: null,
    })
  })

  it('clearPending clears the play, the position and the furthest it sent', () => {
    const state = stateOf(
      entry({ pending: { play: true, position: 42, furthest: 42, at: 9, accountId: null } }),
    )
    const next = clearPending({
      state,
      downloadId: ID,
      sentPlay: true,
      sentPosition: 42,
      sentFurthest: 42,
    })
    expect(next.entries[0]?.pending ?? null).toEqual({
      play: false,
      position: null,
      furthest: null,
      at: 9,
      accountId: null,
    })
  })

  it('clearPending keeps a play it did not send', () => {
    const state = stateOf(
      entry({ pending: { play: true, position: 42, furthest: 42, at: 9, accountId: null } }),
    )
    const next = clearPending({
      state,
      downloadId: ID,
      sentPlay: false,
      sentPosition: 42,
      sentFurthest: 42,
    })
    expect(next.entries[0]?.pending ?? null).toEqual({
      play: true,
      position: null,
      furthest: null,
      at: 9,
      accountId: null,
    })
  })

  it('clearPending keeps a newer position', () => {
    const state = stateOf(
      entry({ pending: { play: true, position: 60, furthest: 60, at: 12, accountId: null } }),
    )
    const next = clearPending({
      state,
      downloadId: ID,
      sentPlay: true,
      sentPosition: 42,
      sentFurthest: 42,
    })
    expect(next.entries[0]?.pending ?? null).toEqual({
      play: false,
      position: 60,
      furthest: 60,
      at: 12,
      accountId: null,
    })
  })

  it('clearPending keeps a furthest raised past the one it sent', () => {
    const state = stateOf(
      entry({ pending: { play: false, position: 70, furthest: 99, at: 12, accountId: null } }),
    )
    const next = clearPending({
      state,
      downloadId: ID,
      sentPlay: false,
      sentPosition: null,
      sentFurthest: 95,
    })
    expect(next).toBe(state)
  })

  it('clearPending of nothing pending returns the same state', () => {
    const state = stateOf(entry())
    expect(
      clearPending({
        state,
        downloadId: ID,
        sentPlay: true,
        sentPosition: null,
        sentFurthest: null,
      }),
    ).toBe(state)
  })
})

describe('forgetServerPosition', () => {
  it("drops the server's resume spot once a position is noted here", () => {
    const next = forgetServerPosition({
      state: stateOf(entry({ serverPosition: 4200 })),
      downloadId: ID,
    })
    expect(next.entries[0]?.serverPosition).toBe(0)
  })

  it('returns the same state when there is none', () => {
    const state = stateOf(entry())
    expect(forgetServerPosition({ state, downloadId: ID })).toBe(state)
  })
})

describe('bytesOf', () => {
  it('is the size when ready, else the status bytes, else 0', () => {
    expect(bytesOf(entry({ status: { kind: DOWNLOAD_STATUS_KINDS.ready } }))).toBe(1000)
    expect(bytesOf(entry({ status: { kind: DOWNLOAD_STATUS_KINDS.downloading, bytes: 7 } }))).toBe(
      7,
    )
    expect(
      bytesOf(
        entry({
          status: { kind: DOWNLOAD_STATUS_KINDS.paused, bytes: 8, reason: PAUSE_REASONS.viewer },
        }),
      ),
    ).toBe(8)
    expect(
      bytesOf(
        entry({
          status: { kind: DOWNLOAD_STATUS_KINDS.failed, bytes: 9, reason: FAIL_REASONS.gone },
        }),
      ),
    ).toBe(9)
    expect(bytesOf(entry({ status: { kind: DOWNLOAD_STATUS_KINDS.queued } }))).toBe(0)
  })
})

describe('sortDownloads', () => {
  const row = (n: number, key: string, order: number, createdAt: number): DownloadEntry =>
    entry({
      downloadId: id(n),
      mediaId: n,
      group: { kind: 'season', key, title: 'Severance', order },
      createdAt,
    })

  it('puts the newest first when no row is grouped', () => {
    const rows = [row(1, 'show:1', 0, 10), row(2, 'show:2', 0, 30), row(3, 'show:3', 0, 20)]
    expect(sortDownloads(rows).map((each) => each.mediaId)).toEqual([2, 3, 1])
  })

  it('keeps a group together in order, under its newest row, newest group first', () => {
    const rows = [
      row(1, 'show:4', 2, 50),
      row(2, 'movie:2', 0, 40),
      row(3, 'show:4', 1, 10),
      row(4, 'show:9', 0, 60),
      row(5, 'show:4', 3, 20),
    ]
    expect(sortDownloads(rows).map((each) => each.mediaId)).toEqual([4, 3, 1, 5, 2])
  })

  it('groups only within a server', () => {
    const rows = [
      row(1, 'show:4', 1, 10),
      entry({
        downloadId: id(2),
        mediaId: 2,
        serverId: SERVER_B,
        group: { kind: 'season', key: 'show:4', title: 'Severance', order: 0 },
        createdAt: 30,
      }),
      row(3, 'show:4', 2, 20),
    ]
    expect(sortDownloads(rows).map((each) => each.mediaId)).toEqual([2, 1, 3])
  })

  it('puts an episode downloaded alone with its season downloaded later', () => {
    const alone = entry({
      downloadId: id(1),
      mediaId: 1,
      group: { kind: 'episode', key: 'show:4', title: 'Severance', order: 10_002 },
      createdAt: 10,
    })
    const movie = row(2, 'movie:2', 0, 20)
    const first = row(3, 'show:4', 10_001, 30)
    const third = row(4, 'show:4', 10_003, 30)
    expect(sameGroup({ a: alone, b: first })).toBe(true)
    expect(sortDownloads([alone, movie, first, third]).map((each) => each.mediaId)).toEqual([
      3, 1, 4, 2,
    ])
  })

  it('keeps two shows of one name on one server apart', () => {
    const of = (n: number, key: string, order: number, createdAt: number) =>
      entry({
        downloadId: id(n),
        mediaId: n,
        group: { kind: 'show', key, title: 'The Office', order },
        createdAt,
      })
    const pilot = of(1, 'show:7', 10_001, 10)
    const remake = of(2, 'show:8', 10_001, 20)
    const second = of(3, 'show:7', 10_002, 30)
    expect(sameGroup({ a: pilot, b: remake })).toBe(false)
    expect(sortDownloads([pilot, remake, second]).map((each) => each.mediaId)).toEqual([1, 3, 2])
  })

  it('does not change its input', () => {
    const rows = [row(1, 'show:1', 0, 10), row(2, 'show:2', 0, 30)]
    sortDownloads(rows)
    expect(rows.map((each) => each.mediaId)).toEqual([1, 2])
  })
})

describe('sameGroup', () => {
  const of = (overrides: Partial<DownloadEntry>): DownloadEntry =>
    entry({
      group: { kind: 'season', key: 'show:4', title: 'Severance', order: 10_001 },
      ...overrides,
    })

  it('is true for one key on one server, whatever the kind, title or order', () => {
    expect(
      sameGroup({
        a: of({}),
        b: of({ group: { kind: 'episode', key: 'show:4', title: 'Renamed', order: 20_005 } }),
      }),
    ).toBe(true)
  })

  it('is false for another key or another server', () => {
    expect(
      sameGroup({
        a: of({}),
        b: of({ group: { kind: 'season', key: 'show:5', title: 'Severance', order: 10_001 } }),
      }),
    ).toBe(false)
    expect(sameGroup({ a: of({}), b: of({ serverId: SERVER_B }) })).toBe(false)
  })
})

describe('an unknown download id', () => {
  const state = stateOf(entry())
  const unknown = id(9)

  it.each([
    ['start', () => start({ state, downloadId: unknown })],
    ['advance', () => advance({ state, downloadId: unknown, bytes: 1 })],
    ['pause', () => pause({ state, downloadId: unknown, reason: PAUSE_REASONS.viewer })],
    ['resume', () => resume({ state, downloadId: unknown })],
    ['fail', () => fail({ state, downloadId: unknown, failure: { reason: FAIL_REASONS.changed } })],
    ['finish', () => finish({ state, downloadId: unknown })],
    ['remove', () => remove({ state, downloadId: unknown })],
    ['setSidecars', () => setSidecars({ state, downloadId: unknown, sidecars: [] })],
    ['setAutoDelete', () => setAutoDelete({ state, downloadId: unknown, autoDelete: true, at: 1 })],
    [
      'noteWatched',
      () => noteWatched({ state, downloadId: unknown, position: 1, duration: 1, at: 1 }),
    ],
    [
      'notePending',
      () =>
        notePending({
          state,
          downloadId: unknown,
          play: true,
          position: 1,
          at: 1,
          accountId: null,
        }),
    ],
    ['forgetServerPosition', () => forgetServerPosition({ state, downloadId: unknown })],
    [
      'clearPending',
      () =>
        clearPending({
          state,
          downloadId: unknown,
          sentPlay: true,
          sentPosition: null,
          sentFurthest: null,
        }),
    ],
  ])('%s returns the same state', (_name, run) => {
    expect(run()).toBe(state)
  })
})
