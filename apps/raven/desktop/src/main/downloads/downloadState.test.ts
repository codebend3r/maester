import { describe, expect, it } from 'bun:test'
import {
  DOWNLOADS_FILE,
  EMPTY_DOWNLOADS,
  NO_PENDING,
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
  isDownloadsState,
  isWaitingOnOutage,
  noteWatched,
  notePending,
  owedOf,
  pause,
  pauseEverything,
  pauseServer,
  queue,
  remove,
  removeAll,
  removeServer,
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

const SERVER_A = '11111111-1111-4111-8111-111111111111'
const SERVER_B = '22222222-2222-4222-8222-222222222222'
const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

const entry = (overrides: Partial<DownloadEntry> = {}): DownloadEntry => ({
  downloadId: id(1),
  serverId: SERVER_A,
  mediaId: 1,
  label: 'The Two Towers',
  group: { kind: 'movie', key: 'movie:1', title: 'The Two Towers', order: 0 },
  container: 'mkv',
  size: 1000,
  duration: 200,
  watchedPercent: 90,
  sidecars: [],
  status: { kind: 'queued' },
  autoDelete: false,
  watchedAt: null,
  serverPosition: 0,
  pending: NO_PENDING,
  createdAt: 100,
  ...overrides,
})

const stateOf = (...entries: DownloadEntry[]): DownloadsState => ({ ...EMPTY_DOWNLOADS, entries })

const ID = id(1)

describe('the guards', () => {
  it('names the file', () => {
    expect(DOWNLOADS_FILE).toBe('downloads.json')
  })

  it('accepts the empty state and a full entry', () => {
    expect(isDownloadsState(EMPTY_DOWNLOADS)).toBe(true)
    const full = entry({
      sidecars: [{ trackId: 'external-3', title: 'English', language: 'en' }],
      status: { kind: 'paused', bytes: 10, reason: 'viewer' },
      pending: { play: true, position: 12, furthest: 30, at: 5 },
    })
    expect(isDownloadEntry(full)).toBe(true)
    expect(isDownloadsState(stateOf(full))).toBe(true)
  })

  it('accepts what removed downloads still owe their servers, and refuses an owed item of no server', () => {
    const pending = { play: true, position: 12, furthest: 30, at: 5 }
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
    expect(isDownloadsState({ ...EMPTY_DOWNLOADS, version: 2 })).toBe(false)
  })

  it('keeps why a download stopped as a reason, never as the words the page shows', () => {
    const withStatus = (status: unknown) => ({ ...entry(), status })
    expect(isDownloadEntry(withStatus({ kind: 'paused', bytes: 1, reason: 'relocked' }))).toBe(true)
    expect(
      isDownloadEntry(withStatus({ kind: 'failed', bytes: 1, reason: 'other', message: 'x' })),
    ).toBe(true)
    expect(isDownloadEntry(withStatus({ kind: 'paused', bytes: 1, message: null }))).toBe(false)
    expect(isDownloadEntry(withStatus({ kind: 'paused', bytes: 1, reason: 'asleep' }))).toBe(false)
    expect(isDownloadEntry(withStatus({ kind: 'failed', bytes: 1, message: 'x' }))).toBe(false)
    expect(
      isDownloadEntry(withStatus({ kind: 'failed', bytes: 1, reason: 'relocked', message: '' })),
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

describe('lookups', () => {
  const state = stateOf(entry(), entry({ downloadId: id(2), serverId: SERVER_B, mediaId: 2 }))

  it('finds by download id, or null', () => {
    expect(entryById(state, { downloadId: id(2) })?.mediaId).toBe(2)
    expect(entryById(state, { downloadId: id(9) })).toBeNull()
  })

  it('finds by server and media, or null', () => {
    expect(entryByMedia(state, { serverId: SERVER_B, mediaId: 2 })?.downloadId).toBe(id(2))
    expect(entryByMedia(state, { serverId: SERVER_A, mediaId: 2 })).toBeNull()
  })
})

describe('queue', () => {
  it('appends in order', () => {
    const one = entry({ downloadId: id(1), mediaId: 1 })
    const two = entry({ downloadId: id(2), mediaId: 2 })
    expect(queue(EMPTY_DOWNLOADS, { entries: [one, two] }).entries).toEqual([one, two])
  })

  it('skips a server and media already there, and repeats inside the batch', () => {
    const one = entry({ downloadId: id(1), mediaId: 1 })
    const again = entry({ downloadId: id(2), mediaId: 1 })
    const other = entry({ downloadId: id(3), mediaId: 1, serverId: SERVER_B })
    const next = queue(stateOf(one), { entries: [again, other, { ...other, downloadId: id(4) }] })
    expect(next.entries.map((each) => each.downloadId)).toEqual([id(1), id(3)])
  })

  it('returns the same state when nothing is new', () => {
    const state = stateOf(entry())
    expect(queue(state, { entries: [entry({ downloadId: id(2) })] })).toBe(state)
    expect(queue(state, { entries: [] })).toBe(state)
  })
})

describe('start', () => {
  it('moves a queued entry to downloading at 0 bytes', () => {
    const next = start(stateOf(entry({ status: { kind: 'queued' } })), { downloadId: ID })
    expect(next.entries[0]?.status).toEqual({ kind: 'downloading', bytes: 0 })
  })

  // A run that began for a queued file must not undo a pause or a failure that came meanwhile.
  it.each([
    ['paused', { kind: 'paused' as const, bytes: 40, reason: 'noSpace' as const }],
    ['failed', { kind: 'failed' as const, bytes: 70, reason: 'other' as const, message: 'boom' }],
    ['ready', { kind: 'ready' as const }],
    ['downloading', { kind: 'downloading' as const, bytes: 5 }],
  ])('refuses %s with the same state', (_name, status) => {
    const state = stateOf(entry({ status }))
    expect(start(state, { downloadId: ID })).toBe(state)
  })
})

describe('advance', () => {
  it('moves the bytes of a downloading entry', () => {
    const state = stateOf(entry({ status: { kind: 'downloading', bytes: 5 } }))
    expect(advance(state, { downloadId: ID, bytes: 50 }).entries[0]?.status).toEqual({
      kind: 'downloading',
      bytes: 50,
    })
  })

  it('refuses any other status with the same state', () => {
    const state = stateOf(entry({ status: { kind: 'paused', bytes: 5, reason: 'viewer' } }))
    expect(advance(state, { downloadId: ID, bytes: 50 })).toBe(state)
  })

  it('returns the same state for the bytes it already has', () => {
    const state = stateOf(entry({ status: { kind: 'downloading', bytes: 5 } }))
    expect(advance(state, { downloadId: ID, bytes: 5 })).toBe(state)
  })
})

describe('pause', () => {
  it('keeps the bytes and the reason', () => {
    const state = stateOf(entry({ status: { kind: 'downloading', bytes: 30 } }))
    expect(pause(state, { downloadId: ID, reason: 'unreachable' }).entries[0]?.status).toEqual({
      kind: 'paused',
      bytes: 30,
      reason: 'unreachable',
    })
  })

  it('pauses a queued entry at zero bytes, for the viewer', () => {
    expect(
      pause(stateOf(entry()), { downloadId: ID, reason: 'viewer' }).entries[0]?.status,
    ).toEqual({ kind: 'paused', bytes: 0, reason: 'viewer' })
  })

  it('refuses a ready entry with the same state', () => {
    const state = stateOf(entry({ status: { kind: 'ready' } }))
    expect(pause(state, { downloadId: ID, reason: 'viewer' })).toBe(state)
  })
})

describe('pauseServer', () => {
  it('pauses only that server queued and downloading entries', () => {
    const state = stateOf(
      entry({ downloadId: id(1), mediaId: 1, status: { kind: 'queued' } }),
      entry({ downloadId: id(2), mediaId: 2, status: { kind: 'downloading', bytes: 9 } }),
      entry({ downloadId: id(3), mediaId: 3, status: { kind: 'ready' } }),
      entry({
        downloadId: id(4),
        mediaId: 4,
        status: { kind: 'failed', bytes: 1, reason: 'other', message: 'x' },
      }),
      entry({ downloadId: id(5), mediaId: 5, serverId: SERVER_B }),
    )
    const next = pauseServer(state, { serverId: SERVER_A, reason: 'relocked' })
    expect(next.entries.map((each) => each.status)).toEqual([
      { kind: 'paused', bytes: 0, reason: 'relocked' },
      { kind: 'paused', bytes: 9, reason: 'relocked' },
      { kind: 'ready' },
      { kind: 'failed', bytes: 1, reason: 'other', message: 'x' },
      { kind: 'queued' },
    ])
  })

  it('returns the same state when nothing is touched', () => {
    const state = stateOf(entry({ status: { kind: 'ready' } }))
    expect(pauseServer(state, { serverId: SERVER_A, reason: 'viewer' })).toBe(state)
    expect(pauseServer(state, { serverId: SERVER_B, reason: 'viewer' })).toBe(state)
  })
})

describe('pauseEverything', () => {
  it('pauses what runs or waits, and what waits on an outage, for the viewer', () => {
    const state = stateOf(
      entry({ downloadId: id(1), mediaId: 1, status: { kind: 'queued' } }),
      entry({ downloadId: id(2), mediaId: 2, status: { kind: 'downloading', bytes: 9 } }),
      entry({
        downloadId: id(3),
        mediaId: 3,
        status: { kind: 'paused', bytes: 4, reason: 'unreachable' },
      }),
      entry({
        downloadId: id(4),
        mediaId: 4,
        status: { kind: 'failed', bytes: 5, reason: 'unreachable', message: '' },
      }),
      entry({
        downloadId: id(5),
        mediaId: 5,
        status: { kind: 'paused', bytes: 6, reason: 'relocked' },
      }),
      entry({
        downloadId: id(6),
        mediaId: 6,
        status: { kind: 'failed', bytes: 7, reason: 'changed', message: '' },
      }),
      entry({ downloadId: id(7), mediaId: 7, status: { kind: 'ready' } }),
    )
    expect(pauseEverything(state).entries.map((each) => each.status)).toEqual([
      { kind: 'paused', bytes: 0, reason: 'viewer' },
      { kind: 'paused', bytes: 9, reason: 'viewer' },
      { kind: 'paused', bytes: 4, reason: 'viewer' },
      { kind: 'paused', bytes: 5, reason: 'viewer' },
      { kind: 'paused', bytes: 6, reason: 'relocked' },
      { kind: 'failed', bytes: 7, reason: 'changed', message: '' },
      { kind: 'ready' },
    ])
  })

  it('returns the same state when nothing is touched', () => {
    const state = stateOf(entry({ status: { kind: 'paused', bytes: 1, reason: 'viewer' } }))
    expect(pauseEverything(state)).toBe(state)
  })
})

describe('isWaitingOnOutage', () => {
  it('is true for a file paused or failed for an outage, and no other', () => {
    const of = (status: DownloadEntry['status']) => isWaitingOnOutage(entry({ status }))
    expect(of({ kind: 'paused', bytes: 0, reason: 'unreachable' })).toBe(true)
    expect(of({ kind: 'failed', bytes: 0, reason: 'unreachable', message: '' })).toBe(true)
    expect(of({ kind: 'paused', bytes: 0, reason: 'viewer' })).toBe(false)
    expect(of({ kind: 'failed', bytes: 0, reason: 'gone', message: '' })).toBe(false)
    expect(of({ kind: 'queued' })).toBe(false)
  })
})

describe('resume', () => {
  it.each([
    ['paused', { kind: 'paused' as const, bytes: 3, reason: 'viewer' as const }],
    ['failed', { kind: 'failed' as const, bytes: 3, reason: 'other' as const, message: 'x' }],
  ])('makes %s queued', (_name, status) => {
    expect(resume(stateOf(entry({ status })), { downloadId: ID }).entries[0]?.status).toEqual({
      kind: 'queued',
    })
  })

  it('refuses a downloading entry with the same state', () => {
    const state = stateOf(entry({ status: { kind: 'downloading', bytes: 3 } }))
    expect(resume(state, { downloadId: ID })).toBe(state)
  })
})

describe('fail and finish', () => {
  it('fail keeps the bytes, the reason and the words of an other failure', () => {
    const state = stateOf(entry({ status: { kind: 'downloading', bytes: 12 } }))
    expect(
      fail(state, { downloadId: ID, reason: 'other', message: 'write EIO' }).entries[0]?.status,
    ).toEqual({ kind: 'failed', bytes: 12, reason: 'other', message: 'write EIO' })
  })

  it('fail keeps no words for a reason that says it all', () => {
    const state = stateOf(entry({ status: { kind: 'downloading', bytes: 12 } }))
    expect(fail(state, { downloadId: ID, reason: 'noSpace' }).entries[0]?.status).toEqual({
      kind: 'failed',
      bytes: 12,
      reason: 'noSpace',
      message: '',
    })
  })

  it('finish makes the entry ready', () => {
    const state = stateOf(entry({ status: { kind: 'downloading', bytes: 1000 } }))
    expect(finish(state, { downloadId: ID }).entries[0]?.status).toEqual({ kind: 'ready' })
  })

  it('a ready entry stays as it is', () => {
    const state = stateOf(entry({ status: { kind: 'ready' } }))
    expect(fail(state, { downloadId: ID, reason: 'changed' })).toBe(state)
    expect(finish(state, { downloadId: ID })).toBe(state)
  })
})

describe('remove and removeServer', () => {
  const state = stateOf(
    entry({ downloadId: id(1), mediaId: 1 }),
    entry({ downloadId: id(2), mediaId: 2, serverId: SERVER_B }),
  )

  it('remove drops one entry', () => {
    expect(remove(state, { downloadId: id(1) }).entries.map((each) => each.downloadId)).toEqual([
      id(2),
    ])
  })

  it('removeServer drops that server entries', () => {
    expect(
      removeServer(state, { serverId: SERVER_B }).entries.map((each) => each.downloadId),
    ).toEqual([id(1)])
  })

  it('removeServer for a server with none returns the same state', () => {
    expect(removeServer(state, { serverId: id(9) })).toBe(state)
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
  const PLAYED: Pending = { play: true, position: 180, furthest: 190, at: 50 }
  const owing = stateOf(
    entry({ downloadId: id(1), mediaId: 1, pending: PLAYED }),
    entry({ downloadId: id(2), mediaId: 2, serverId: SERVER_B, pending: PLAYED }),
    entry({ downloadId: id(3), mediaId: 3 }),
  )

  it('remove moves the pending of the entry it drops into owed', () => {
    const next = remove(owing, { downloadId: id(1) })
    expect(next.entries.map((each) => each.downloadId)).toEqual([id(2), id(3)])
    expect(next.owed).toEqual([{ serverId: SERVER_A, mediaId: 1, pending: PLAYED }])
  })

  it('remove of an entry with nothing pending owes nothing', () => {
    expect(remove(owing, { downloadId: id(3) }).owed).toEqual([])
  })

  it('removeAll moves every pending into owed', () => {
    expect(removeAll(owing).owed).toEqual([
      { serverId: SERVER_A, mediaId: 1, pending: PLAYED },
      { serverId: SERVER_B, mediaId: 2, pending: PLAYED },
    ])
  })

  it("removeServer owes nothing for that server's entries, and drops what it was owed", () => {
    const owed = remove(owing, { downloadId: id(1) })
    const next = removeServer(removeServer(owed, { serverId: SERVER_A }), { serverId: SERVER_B })
    expect(next.entries).toEqual([])
    expect(next.owed).toEqual([])
    expect(removeServer(owed, { serverId: SERVER_A }).owed).toEqual([])
  })

  it('removeServer of a server owed something but holding no entry drops it', () => {
    const owed = remove(stateOf(entry({ pending: PLAYED })), { downloadId: ID })
    expect(removeServer(owed, { serverId: SERVER_A }).owed).toEqual([])
  })

  it('folds a title already owed into one item: the play kept, the newer position, the furthest', () => {
    const first = remove(owing, { downloadId: id(1) })
    const again = queue(first, {
      entries: [
        entry({
          downloadId: id(4),
          mediaId: 1,
          pending: { play: false, position: 20, furthest: 40, at: 90 },
        }),
      ],
    })
    expect(remove(again, { downloadId: id(4) }).owed).toEqual([
      {
        serverId: SERVER_A,
        mediaId: 1,
        pending: { play: true, position: 20, furthest: 190, at: 90 },
      },
    ])
  })

  it('folds a title owed a high position with no furthest so the furthest is not below the position', () => {
    const first = remove(
      stateOf(
        entry({
          downloadId: id(1),
          mediaId: 1,
          pending: { play: false, position: 180, furthest: null, at: 50 },
        }),
      ),
      { downloadId: id(1) },
    )
    const again = queue(first, {
      entries: [
        entry({
          downloadId: id(4),
          mediaId: 1,
          pending: { play: false, position: null, furthest: 40, at: 90 },
        }),
      ],
    })
    expect(remove(again, { downloadId: id(4) }).owed).toEqual([
      {
        serverId: SERVER_A,
        mediaId: 1,
        pending: { play: false, position: 180, furthest: 180, at: 90 },
      },
    ])
  })

  it('folds a title whose furthest already reaches the position without changing it', () => {
    const first = remove(owing, { downloadId: id(1) })
    const again = queue(first, {
      entries: [
        entry({
          downloadId: id(4),
          mediaId: 1,
          pending: { play: false, position: 185, furthest: null, at: 90 },
        }),
      ],
    })
    expect(remove(again, { downloadId: id(4) }).owed).toEqual([
      {
        serverId: SERVER_A,
        mediaId: 1,
        pending: { play: true, position: 185, furthest: 190, at: 90 },
      },
    ])
  })

  it('owedOf finds an owed item by server and media, or null', () => {
    const owed = remove(owing, { downloadId: id(1) })
    expect(owedOf(owed, { serverId: SERVER_A, mediaId: 1 })?.pending).toEqual(PLAYED)
    expect(owedOf(owed, { serverId: SERVER_B, mediaId: 1 })).toBeNull()
  })

  it('clearOwed clears what was sent, and drops the item once nothing is left', () => {
    const owed = remove(owing, { downloadId: id(1) })
    const key = { serverId: SERVER_A, mediaId: 1 }
    const played = clearOwed(owed, {
      ...key,
      sentPlay: true,
      sentPosition: null,
      sentFurthest: null,
    })
    expect(owedOf(played, key)?.pending).toEqual({ ...PLAYED, play: false })
    const furthest = clearOwed(played, {
      ...key,
      sentPlay: false,
      sentPosition: null,
      sentFurthest: 190,
    })
    expect(owedOf(furthest, key)?.pending).toEqual({ ...PLAYED, play: false, furthest: null })
    expect(
      clearOwed(furthest, { ...key, sentPlay: false, sentPosition: 180, sentFurthest: 180 }).owed,
    ).toEqual([])
  })

  it('clearOwed keeps a position other than the one sent, and changes nothing for an item not owed', () => {
    const owed = remove(owing, { downloadId: id(1) })
    const key = { serverId: SERVER_A, mediaId: 1 }
    const next = clearOwed(owed, { ...key, sentPlay: true, sentPosition: 100, sentFurthest: 190 })
    expect(owedOf(next, key)?.pending).toEqual({
      play: false,
      position: 180,
      furthest: null,
      at: 50,
    })
    expect(
      clearOwed(owed, {
        serverId: SERVER_B,
        mediaId: 1,
        sentPlay: true,
        sentPosition: 180,
        sentFurthest: 190,
      }),
    ).toBe(owed)
  })

  it('dropOwed drops one item, and changes nothing for an item not owed', () => {
    const owed = removeAll(owing)
    expect(dropOwed(owed, { serverId: SERVER_A, mediaId: 1 }).owed).toEqual([
      { serverId: SERVER_B, mediaId: 2, pending: PLAYED },
    ])
    expect(dropOwed(owed, { serverId: SERVER_A, mediaId: 2 })).toBe(owed)
  })
})

describe('setSidecars', () => {
  const sidecars = [{ trackId: 'external-0', title: 'English', language: 'en' }]

  it('sets the subtitles kept beside the video', () => {
    expect(
      setSidecars(stateOf(entry()), { downloadId: ID, sidecars }).entries[0]?.sidecars,
    ).toEqual(sidecars)
  })

  it('returns the same state for no subtitles where there were none', () => {
    const state = stateOf(entry())
    expect(setSidecars(state, { downloadId: ID, sidecars: [] })).toBe(state)
  })
})

describe('auto-delete', () => {
  it('setAutoDelete sets one entry', () => {
    const next = setAutoDelete(stateOf(entry()), { downloadId: ID, autoDelete: true, at: 500 })
    expect(next.entries[0]?.autoDelete).toBe(true)
  })

  it('setAutoDelete to the same value returns the same state', () => {
    const state = stateOf(entry({ autoDelete: true, watchedAt: 100 }))
    expect(setAutoDelete(state, { downloadId: ID, autoDelete: true, at: 500 })).toBe(state)
  })

  it('setAutoDelete moves an older watchedAt up to the switch when it is turned on', () => {
    const next = setAutoDelete(stateOf(entry({ watchedAt: 100 })), {
      downloadId: ID,
      autoDelete: true,
      at: 500,
    })
    expect(next.entries[0]).toMatchObject({ autoDelete: true, watchedAt: 500 })
  })

  it('setAutoDelete leaves watchedAt when turned off, and a title not watched unwatched', () => {
    const off = setAutoDelete(stateOf(entry({ autoDelete: true, watchedAt: 100 })), {
      downloadId: ID,
      autoDelete: false,
      at: 500,
    })
    expect(off.entries[0]).toMatchObject({ autoDelete: false, watchedAt: 100 })
    const unwatched = setAutoDelete(stateOf(entry()), { downloadId: ID, autoDelete: true, at: 500 })
    expect(unwatched.entries[0]?.watchedAt).toBeNull()
  })

  it('setAutoDeleteDefault sets the default, and the same value changes nothing', () => {
    const on = setAutoDeleteDefault(EMPTY_DOWNLOADS, { autoDelete: true })
    expect(on.autoDeleteDefault).toBe(true)
    expect(setAutoDeleteDefault(on, { autoDelete: true })).toBe(on)
  })
})

describe('noteWatched', () => {
  const watch = (state: DownloadsState, position: number, duration: number | null = 200) =>
    noteWatched(state, { downloadId: ID, position, duration, at: 777 })

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
    const next = notePending(stateOf(entry()), {
      downloadId: ID,
      play: true,
      position: 42,
      at: 9,
    })
    expect(next.entries[0]?.pending).toEqual({ play: true, position: 42, furthest: 42, at: 9 })
  })

  it('notePending keeps the furthest position through a scrub back, and raises it past', () => {
    const watched = notePending(stateOf(entry()), {
      downloadId: ID,
      play: true,
      position: 190,
      at: 1,
    })
    const back = notePending(watched, { downloadId: ID, play: false, position: 140, at: 2 })
    expect(back.entries[0]?.pending).toEqual({ play: true, position: 140, furthest: 190, at: 2 })
    const past = notePending(back, { downloadId: ID, play: false, position: 195, at: 3 })
    expect(past.entries[0]?.pending).toEqual({ play: true, position: 195, furthest: 195, at: 3 })
  })

  it('notePending keeps a play the server has not heard when a position report follows', () => {
    const played = notePending(stateOf(entry()), {
      downloadId: ID,
      play: true,
      position: 10,
      at: 1,
    })
    const next = notePending(played, { downloadId: ID, play: false, position: 20, at: 2 })
    expect(next.entries[0]?.pending).toEqual({ play: true, position: 20, furthest: 20, at: 2 })
  })

  it('clearPending clears the play, the position and the furthest it sent', () => {
    const state = stateOf(entry({ pending: { play: true, position: 42, furthest: 42, at: 9 } }))
    const next = clearPending(state, {
      downloadId: ID,
      sentPlay: true,
      sentPosition: 42,
      sentFurthest: 42,
    })
    expect(next.entries[0]?.pending).toEqual({ play: false, position: null, furthest: null, at: 9 })
  })

  it('clearPending keeps a play it did not send', () => {
    const state = stateOf(entry({ pending: { play: true, position: 42, furthest: 42, at: 9 } }))
    const next = clearPending(state, {
      downloadId: ID,
      sentPlay: false,
      sentPosition: 42,
      sentFurthest: 42,
    })
    expect(next.entries[0]?.pending).toEqual({ play: true, position: null, furthest: null, at: 9 })
  })

  it('clearPending keeps a newer position', () => {
    const state = stateOf(entry({ pending: { play: true, position: 60, furthest: 60, at: 12 } }))
    const next = clearPending(state, {
      downloadId: ID,
      sentPlay: true,
      sentPosition: 42,
      sentFurthest: 42,
    })
    expect(next.entries[0]?.pending).toEqual({ play: false, position: 60, furthest: 60, at: 12 })
  })

  it('clearPending keeps a furthest raised past the one it sent', () => {
    const state = stateOf(entry({ pending: { play: false, position: 70, furthest: 99, at: 12 } }))
    const next = clearPending(state, {
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
      clearPending(state, {
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
    const next = forgetServerPosition(stateOf(entry({ serverPosition: 4200 })), { downloadId: ID })
    expect(next.entries[0]?.serverPosition).toBe(0)
  })

  it('returns the same state when there is none', () => {
    const state = stateOf(entry())
    expect(forgetServerPosition(state, { downloadId: ID })).toBe(state)
  })
})

describe('bytesOf', () => {
  it('is the size when ready, else the status bytes, else 0', () => {
    expect(bytesOf(entry({ status: { kind: 'ready' } }))).toBe(1000)
    expect(bytesOf(entry({ status: { kind: 'downloading', bytes: 7 } }))).toBe(7)
    expect(bytesOf(entry({ status: { kind: 'paused', bytes: 8, reason: 'viewer' } }))).toBe(8)
    expect(
      bytesOf(entry({ status: { kind: 'failed', bytes: 9, reason: 'gone', message: '' } })),
    ).toBe(9)
    expect(bytesOf(entry({ status: { kind: 'queued' } }))).toBe(0)
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
    ['start', () => start(state, { downloadId: unknown })],
    ['advance', () => advance(state, { downloadId: unknown, bytes: 1 })],
    ['pause', () => pause(state, { downloadId: unknown, reason: 'viewer' })],
    ['resume', () => resume(state, { downloadId: unknown })],
    ['fail', () => fail(state, { downloadId: unknown, reason: 'changed' })],
    ['finish', () => finish(state, { downloadId: unknown })],
    ['remove', () => remove(state, { downloadId: unknown })],
    ['setSidecars', () => setSidecars(state, { downloadId: unknown, sidecars: [] })],
    ['setAutoDelete', () => setAutoDelete(state, { downloadId: unknown, autoDelete: true, at: 1 })],
    [
      'noteWatched',
      () => noteWatched(state, { downloadId: unknown, position: 1, duration: 1, at: 1 }),
    ],
    [
      'notePending',
      () => notePending(state, { downloadId: unknown, play: true, position: 1, at: 1 }),
    ],
    ['forgetServerPosition', () => forgetServerPosition(state, { downloadId: unknown })],
    [
      'clearPending',
      () =>
        clearPending(state, {
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
