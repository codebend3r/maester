import {
  ApiError,
  DEVICE_DOWNLOAD_STATES,
  DOWNLOAD_ASK_KINDS,
  DOWNLOAD_STATUS_KINDS,
  DOWNLOAD_TARGET_KINDS,
  type MediaTracks,
  type SubtitleTrack,
  CONTAINERS,
  DOWNLOAD_ARTWORK_KINDS,
  DOWNLOAD_KINDS,
  ITEM_IMAGE_KINDS,
  ITEM_TYPES,
  type MediaItem,
  SUBTITLE_SOURCES,
} from '@raven/core'
import { describe, expect, it } from 'bun:test'
import { waitFor } from '@testing-library/react'
import { ABORT } from '@/browserDownloads/clock'
import { BROWSER_DOWNLOAD_COPY } from '@/browserDownloads/copy'
import type { DownloadsNews } from '@/browserDownloads/engine'
import { INDEX_PATH, readIndex } from '@/browserDownloads/entries'
import { STALL_MS } from '@/browserDownloads/fetchBytes'
import { PREPARE_POLL_MS } from '@/browserDownloads/prepareCopy'
import { DOWNLOAD_WAYS } from '@/browserDownloads/ways'
import {
  ACCOUNT,
  bytesOfLength,
  fakeDisk,
  fakeEngine,
  fakeServer,
  OTHER_ACCOUNT,
  queueVideo,
  rangedAnswer,
  statusAnswer,
  statusesOf,
  stuckAnswer,
  untilAllReady,
  videoTarget,
} from '@/test/browserDownloads'
import { itemDetails, itemSummary, library, mediaItem } from '@/test/fixtures'

const MOVIE = mediaItem({
  id: 7,
  container: CONTAINERS.mp4,
  size: 10,
  item: itemSummary({ id: 40 }),
})
const SECOND = mediaItem({ id: 8, container: CONTAINERS.mp4, size: 6, title: 'Second', item: null })
const FILES = { 7: bytesOfLength(10), 8: bytesOfLength(6) }

const server = (props: Parameters<typeof fakeServer>[0] = {}) =>
  fakeServer({
    media: [MOVIE, SECOND],
    items: [itemDetails({ id: 40, posterVersion: null, logoVersion: null })],
    files: FILES,
    ...props,
  })

describe('browser downloads: asking', () => {
  it('lists a video to fetch with its size and the room there is', async () => {
    const { engine } = await fakeEngine({ server: server() })
    const asked = await engine.ask(videoTarget(7))
    expect(asked).toMatchObject({
      ok: true,
      value: {
        status: { kind: DOWNLOAD_ASK_KINDS.ready, files: 1, bytes: 10 },
      },
    })
  })

  it('refuses at the ask what the browser has no room for', async () => {
    const { engine } = await fakeEngine({ server: server(), disk: fakeDisk({ quota: 5 }) })
    const asked = await engine.ask(videoTarget(7))
    expect(asked).toMatchObject({ ok: true, value: { status: { canFit: false, free: 5 } } })
  })

  it('counts the room the downloads on their way still take', async () => {
    const stuck = stuckAnswer(bytesOfLength(2))
    const fake = server()
    fake.answers.push(stuck.answer)
    const { engine } = await fakeEngine({ server: fake, disk: fakeDisk({ quota: 14 }) })
    await queueVideo({ engine, mediaId: 7 })
    await waitFor(() => expect(statusesOf(engine)).toEqual([DOWNLOAD_STATUS_KINDS.downloading]))
    const asked = await engine.ask(videoTarget(8))
    expect(asked).toMatchObject({ ok: true, value: { status: { bytes: 6, canFit: false } } })
    stuck.finish(bytesOfLength(8))
  })

  it('says a title in a locked library is locked, as Raven does', async () => {
    const fake = server()
    fake.server.api.getMedia = async () => {
      throw new ApiError({ status: 423, message: 'Locked' })
    }
    const { engine } = await fakeEngine({ server: fake })
    const asked = await engine.ask(videoTarget(7))
    expect(asked).toMatchObject({
      ok: true,
      value: { status: { kind: DOWNLOAD_ASK_KINDS.locked } },
    })
  })

  it('refuses with why for a title the server no longer has, or did not answer for', async () => {
    const fake = server()
    const { engine } = await fakeEngine({ server: fake })
    fake.server.api.getMedia = async () => {
      throw new ApiError({ status: 404, message: 'Not found' })
    }
    expect(await engine.ask(videoTarget(7))).toEqual({
      ok: false,
      message: BROWSER_DOWNLOAD_COPY.gone,
    })
    fake.server.api.getMedia = async () => {
      throw new ApiError({ status: 403, message: 'No' })
    }
    expect(await engine.ask(videoTarget(7))).toEqual({
      ok: false,
      message: BROWSER_DOWNLOAD_COPY.account,
    })
    fake.server.api.getMedia = async () => {
      throw new TypeError('Failed to fetch')
    }
    expect(await engine.ask(videoTarget(7))).toEqual({
      ok: false,
      message: BROWSER_DOWNLOAD_COPY.unreachable,
    })
  })

  it('asks a page with no account to sign in first', async () => {
    const { engine } = await fakeEngine({ server: server(), account: null })
    const asked = await engine.ask(videoTarget(7))
    expect(asked).toMatchObject({
      ok: true,
      value: { status: { kind: DOWNLOAD_ASK_KINDS.account } },
    })
  })

  it('lists nothing to fetch for a video already downloaded', async () => {
    const { engine } = await fakeEngine({ server: server() })
    await queueVideo({ engine, mediaId: 7 })
    const again = await engine.ask(videoTarget(7))
    expect(again).toMatchObject({ ok: true, value: { status: { files: 0 } } })
  })

  it('refuses a confirmation of an ask it no longer holds, and forgets a declined one', async () => {
    const { engine } = await fakeEngine({ server: server() })
    const asked = await engine.ask(videoTarget(7))
    if (!asked.ok) throw new Error(asked.message)
    engine.decline(asked.value.askId)
    expect(engine.confirm(asked.value.askId)).toEqual({
      ok: false,
      message: BROWSER_DOWNLOAD_COPY.askGone,
    })
    expect(engine.list()).toEqual([])
  })

  it('asks the browser to keep its storage when the first download is confirmed', async () => {
    const disk = fakeDisk()
    const { engine } = await fakeEngine({ server: server(), disk })
    await queueVideo({ engine, mediaId: 7 })
    await queueVideo({ engine, mediaId: 8 })
    expect(disk.disk.persist).toHaveBeenCalledTimes(1)
  })
})

describe('browser downloads: the queue', () => {
  it('downloads one file at a time, in the order they were confirmed', async () => {
    const fake = server()
    const { engine, disk } = await fakeEngine({ server: fake })
    await queueVideo({ engine, mediaId: 7 })
    await queueVideo({ engine, mediaId: 8 })
    await untilAllReady(engine)
    expect(fake.calls.map(({ mediaId }) => mediaId)).toEqual([7, 8])
    const [first, second] = engine.list()
    expect(first?.label ?? null).toBe('Busboys (2026)')
    expect(second?.label ?? null).toBe('Second')
    const kept = disk.names().filter((name) => name.endsWith('media.mp4'))
    expect(kept).toHaveLength(2)
    expect(kept.every((name) => name.startsWith(`downloads/${ACCOUNT}/`))).toBe(true)
  })

  it('holds the second file while the first is on its way', async () => {
    const stuck = stuckAnswer(bytesOfLength(2))
    const fake = server()
    fake.answers.push(stuck.answer)
    const { engine } = await fakeEngine({ server: fake })
    await queueVideo({ engine, mediaId: 7 })
    await queueVideo({ engine, mediaId: 8 })
    await waitFor(() =>
      expect(engine.list().map(({ status }) => status)).toEqual([
        { kind: DOWNLOAD_STATUS_KINDS.downloading, bytes: 2 },
        { kind: DOWNLOAD_STATUS_KINDS.queued },
      ]),
    )
    stuck.finish(FILES[7].slice(2))
    await untilAllReady(engine)
  })

  it('tells the page of each change, and stops once it lets go', async () => {
    const changes: DownloadsNews[] = []
    const { engine } = await fakeEngine({ server: server() })
    const stop = engine.subscribe((change) => changes.push(change))
    await queueVideo({ engine, mediaId: 7 })
    await untilAllReady(engine)
    expect(changes.at(-1)?.downloads[0]?.status ?? null).toEqual({
      kind: DOWNLOAD_STATUS_KINDS.ready,
    })
    stop()
    const heard = changes.length
    await queueVideo({ engine, mediaId: 8 })
    await untilAllReady(engine)
    expect(changes).toHaveLength(heard)
  })

  it('resumes from the bytes on disk with a range, after a pause', async () => {
    const stuck = stuckAnswer(FILES[7].slice(0, 4))
    const fake = server()
    fake.answers.push(stuck.answer)
    const { engine, disk } = await fakeEngine({ server: fake })
    await queueVideo({ engine, mediaId: 7 })
    await waitFor(() => expect(statusesOf(engine)).toEqual([DOWNLOAD_STATUS_KINDS.downloading]))
    const [view] = engine.list()
    engine.pause(view?.downloadId ?? '')
    expect(engine.list()[0]?.status ?? null).toEqual({
      kind: DOWNLOAD_STATUS_KINDS.paused,
      bytes: 4,
      message: null,
    })
    engine.resume(view?.downloadId ?? '')
    await untilAllReady(engine)
    expect(fake.calls.map(({ from }) => from)).toEqual([0, 4])
    const name = disk.names().find((each) => each.endsWith('media.mp4'))
    const file = disk.files.get(name ?? '')
    expect(new Uint8Array((await file?.arrayBuffer()) ?? new ArrayBuffer(0))).toEqual(FILES[7])
  })

  it('starts the file over when the server ignores the range', async () => {
    const stuck = stuckAnswer(FILES[7].slice(0, 4))
    const fake = server()
    fake.answers.push(stuck.answer)
    const { engine, disk } = await fakeEngine({ server: fake })
    await queueVideo({ engine, mediaId: 7 })
    await waitFor(() => expect(statusesOf(engine)).toEqual([DOWNLOAD_STATUS_KINDS.downloading]))
    const id = engine.list()[0]?.downloadId ?? ''
    engine.pause(id)
    fake.answers.push(rangedAnswer({ bytes: FILES[7], from: 0 }))
    engine.resume(id)
    await untilAllReady(engine)
    const name = disk.names().find((each) => each.endsWith('media.mp4'))
    expect(disk.files.get(name ?? '')?.size ?? null).toBe(10)
  })

  it('resumes once by itself when the server cuts a response that sent bytes', async () => {
    const stuck = stuckAnswer(FILES[7].slice(0, 4))
    const fake = server()
    fake.answers.push(stuck.answer)
    const { engine } = await fakeEngine({ server: fake })
    await queueVideo({ engine, mediaId: 7 })
    await waitFor(() => expect(statusesOf(engine)).toEqual([DOWNLOAD_STATUS_KINDS.downloading]))
    stuck.cut()
    await untilAllReady(engine)
    expect(fake.calls).toEqual([
      { mediaId: 7, way: DOWNLOAD_WAYS.file, from: 0, isFresh: false },
      { mediaId: 7, way: DOWNLOAD_WAYS.file, from: 4, isFresh: true },
    ])
  })

  it('pauses on a lost connection, and takes up again once the server answers', async () => {
    const fake = server()
    fake.answers.push(new TypeError('Failed to fetch'))
    const { engine } = await fakeEngine({ server: fake })
    await queueVideo({ engine, mediaId: 7 })
    await waitFor(() =>
      expect(engine.list()[0]?.status ?? null).toEqual({
        kind: DOWNLOAD_STATUS_KINDS.paused,
        bytes: 0,
        message: BROWSER_DOWNLOAD_COPY.outage,
      }),
    )
    engine.reconnected()
    await untilAllReady(engine)
  })

  it('leaves a download the viewer paused alone when the server answers again', async () => {
    const stuck = stuckAnswer(bytesOfLength(2))
    const fake = server()
    fake.answers.push(stuck.answer)
    const { engine } = await fakeEngine({ server: fake })
    await queueVideo({ engine, mediaId: 7 })
    await waitFor(() => expect(statusesOf(engine)).toEqual([DOWNLOAD_STATUS_KINDS.downloading]))
    engine.pause(engine.list()[0]?.downloadId ?? '')
    engine.reconnected()
    expect(statusesOf(engine)).toEqual([DOWNLOAD_STATUS_KINDS.paused])
  })

  it('asks again with a new ticket after one 401, and fails on a refusal', async () => {
    const fake = server()
    fake.answers.push(statusAnswer(401))
    const { engine } = await fakeEngine({ server: fake })
    await queueVideo({ engine, mediaId: 7 })
    await untilAllReady(engine)
    expect(fake.calls.map(({ isFresh }) => isFresh)).toEqual([false, true])
    fake.answers.push(statusAnswer(403))
    await queueVideo({ engine, mediaId: 8 })
    await waitFor(() =>
      expect(engine.list()[1]?.status ?? null).toEqual({
        kind: DOWNLOAD_STATUS_KINDS.failed,
        bytes: 0,
        message: BROWSER_DOWNLOAD_COPY.account,
      }),
    )
  })

  it.each([
    [404, BROWSER_DOWNLOAD_COPY.gone],
    [423, BROWSER_DOWNLOAD_COPY.locked],
    [500, BROWSER_DOWNLOAD_COPY.answered(500)],
  ])('fails with why when the server answers %i', async (status, message) => {
    const fake = server()
    fake.answers.push(statusAnswer(status))
    const { engine } = await fakeEngine({ server: fake })
    await queueVideo({ engine, mediaId: 7 })
    await waitFor(() =>
      expect(engine.list()[0]?.status ?? null).toEqual({
        kind: DOWNLOAD_STATUS_KINDS.failed,
        bytes: 0,
        message,
      }),
    )
  })

  it('retries a failed download from Retry', async () => {
    const fake = server()
    fake.answers.push(statusAnswer(500))
    const { engine } = await fakeEngine({ server: fake })
    await queueVideo({ engine, mediaId: 7 })
    await waitFor(() => expect(statusesOf(engine)).toEqual([DOWNLOAD_STATUS_KINDS.failed]))
    engine.resume(engine.list()[0]?.downloadId ?? '')
    await untilAllReady(engine)
  })

  it('starts over a file the server says its range no longer fits', async () => {
    const fake = server()
    fake.answers.push(statusAnswer(416))
    const { engine } = await fakeEngine({ server: fake })
    await queueVideo({ engine, mediaId: 7 })
    await untilAllReady(engine)
    expect(fake.calls).toHaveLength(2)
  })

  it('pauses with why when the browser has no more room', async () => {
    const { engine } = await fakeEngine({ server: server(), disk: fakeDisk({ fullAt: 6 }) })
    await queueVideo({ engine, mediaId: 7 })
    await waitFor(() =>
      expect(engine.list()[0]?.status ?? null).toEqual({
        kind: DOWNLOAD_STATUS_KINDS.paused,
        bytes: 4,
        message: BROWSER_DOWNLOAD_COPY.full,
      }),
    )
  })

  it('pauses and resumes every download at once', async () => {
    const stuck = stuckAnswer(bytesOfLength(2))
    const fake = server()
    fake.answers.push(stuck.answer)
    const { engine } = await fakeEngine({ server: fake })
    await queueVideo({ engine, mediaId: 7 })
    await queueVideo({ engine, mediaId: 8 })
    await waitFor(() => expect(statusesOf(engine)[0]).toBe(DOWNLOAD_STATUS_KINDS.downloading))
    engine.pauseAll()
    expect(statusesOf(engine)).toEqual([DOWNLOAD_STATUS_KINDS.paused, DOWNLOAD_STATUS_KINDS.paused])
    engine.resumeAll()
    await untilAllReady(engine)
  })

  it('deletes a download with its files, the one running too', async () => {
    const stuck = stuckAnswer(bytesOfLength(2))
    const fake = server()
    fake.answers.push(stuck.answer)
    const { engine, disk } = await fakeEngine({ server: fake })
    await queueVideo({ engine, mediaId: 7 })
    await queueVideo({ engine, mediaId: 8 })
    await waitFor(() => expect(statusesOf(engine)[0]).toBe(DOWNLOAD_STATUS_KINDS.downloading))
    await engine.remove(engine.list()[0]?.downloadId ?? '')
    await untilAllReady(engine)
    expect(engine.list().map(({ label }) => label)).toEqual(['Second'])
    expect(disk.names().filter((name) => name.endsWith('media.mp4'))).toHaveLength(1)
    await engine.removeAll()
    expect(engine.list()).toEqual([])
    expect(disk.names()).toEqual(['downloads/index.json'])
  })
})

describe('browser downloads: a response that goes quiet', () => {
  it('gives it up once it has sent nothing for long enough, and resumes once from the bytes it has', async () => {
    const stuck = stuckAnswer(FILES[7].slice(0, 4))
    const fake = server()
    fake.answers.push(stuck.answer)
    const { engine, clock } = await fakeEngine({ server: fake })
    await queueVideo({ engine, mediaId: 7 })
    await waitFor(() => expect(statusesOf(engine)).toEqual([DOWNLOAD_STATUS_KINDS.downloading]))
    clock.advance(STALL_MS)
    await untilAllReady(engine)
    expect(fake.calls).toEqual([
      { mediaId: 7, way: DOWNLOAD_WAYS.file, from: 0, isFresh: false },
      { mediaId: 7, way: DOWNLOAD_WAYS.file, from: 4, isFresh: true },
    ])
    // A finished response is watched no more.
    expect(clock.timers.size).toBe(0)
  })

  it('keeps a response that is slow but still sending', async () => {
    const stuck = stuckAnswer(FILES[7].slice(0, 4))
    const fake = server()
    fake.answers.push(stuck.answer)
    const { engine, clock } = await fakeEngine({ server: fake })
    await queueVideo({ engine, mediaId: 7 })
    await waitFor(() => expect(statusesOf(engine)).toEqual([DOWNLOAD_STATUS_KINDS.downloading]))
    clock.advance(STALL_MS - 1)
    stuck.send(FILES[7].slice(4, 8))
    await waitFor(() =>
      expect(engine.list()[0]?.status ?? null).toEqual({
        kind: DOWNLOAD_STATUS_KINDS.downloading,
        bytes: 8,
      }),
    )
    // The first wait comes due here, a moment short of the silence that gives a response up.
    clock.advance(STALL_MS - 1)
    stuck.finish(FILES[7].slice(8))
    await untilAllReady(engine)
    expect(fake.calls.map(({ from }) => from)).toEqual([0])
  })

  it('pauses as a lost connection when the response never starts', async () => {
    const fake = server()
    fake.server.bytes = ({ signal }) =>
      new Promise((_, reject) => {
        signal.addEventListener(ABORT, () => reject(signal.reason), { once: true })
      })
    const { engine, clock } = await fakeEngine({ server: fake })
    await queueVideo({ engine, mediaId: 7 })
    await waitFor(() => expect(clock.timers.size).toBe(1))
    clock.advance(STALL_MS)
    await waitFor(() =>
      expect(engine.list()[0]?.status ?? null).toEqual({
        kind: DOWNLOAD_STATUS_KINDS.paused,
        bytes: 0,
        message: BROWSER_DOWNLOAD_COPY.outage,
      }),
    )
    expect(clock.timers.size).toBe(0)
  })
})

describe('browser downloads: the server copy', () => {
  const MKV = mediaItem({
    id: 9,
    container: CONTAINERS.mkv,
    size: 50,
    title: 'Matroska',
    item: null,
  })

  it('waits for the copy, saying how far along it is, then fetches it at its own size', async () => {
    const fake = fakeServer({
      media: [MKV],
      files: { 9: bytesOfLength(12) },
      copies: {
        9: [
          { state: DEVICE_DOWNLOAD_STATES.preparing, progress: 0.4 },
          { state: DEVICE_DOWNLOAD_STATES.ready, bytes: 12 },
        ],
      },
    })
    const changes: DownloadsNews[] = []
    const { engine, clock, disk } = await fakeEngine({ server: fake, canPlay: () => false })
    engine.subscribe((change) => changes.push(change))
    const ask = await queueVideo({ engine, mediaId: 9 })
    // The ask can only name the original's size: the copy's is not known until it is made.
    expect(ask.status).toMatchObject({ bytes: 50 })
    await untilAllReady(engine)
    const id = engine.list()[0]?.downloadId ?? ''
    expect(changes.some((change) => change.preparing[id] === 0.4)).toBe(true)
    expect(changes.at(-1)?.preparing ?? null).toEqual({})
    expect(clock.slept).toEqual([PREPARE_POLL_MS])
    expect(engine.list()[0]?.size ?? null).toBe(12)
    expect(fake.calls).toEqual([{ mediaId: 9, way: DOWNLOAD_WAYS.sdr, from: 0, isFresh: false }])
    expect(disk.names().some((name) => name.endsWith('media.mp4'))).toBe(true)
  })

  it('refuses a Dolby Vision only video where the browser does not play it, and asks the server for no copy', async () => {
    const dolbyVision = { ...MKV, isDolbyVisionOnly: true }
    const fake = fakeServer({ media: [dolbyVision] })
    const { engine } = await fakeEngine({
      server: fake,
      canPlay: (mimeType) => !mimeType.includes('dvh1'),
    })
    expect(engine.canKeepDolbyVision).toBe(false)
    expect(await engine.ask(videoTarget(9))).toEqual({
      ok: false,
      message: BROWSER_DOWNLOAD_COPY.dolbyVision,
    })
    expect(fake.asked.copies[9] ?? 0).toBe(0)
  })

  it("fails with the server's own words when it cannot make the copy", async () => {
    const fake = fakeServer({
      media: [MKV],
      copies: { 9: [{ state: DEVICE_DOWNLOAD_STATES.failed, message: 'No Dolby Vision here' }] },
    })
    const { engine } = await fakeEngine({ server: fake, canPlay: () => false })
    await queueVideo({ engine, mediaId: 9 })
    await waitFor(() =>
      expect(engine.list()[0]?.status ?? null).toEqual({
        kind: DOWNLOAD_STATUS_KINDS.failed,
        bytes: 0,
        message: 'No Dolby Vision here',
      }),
    )
    expect(fake.calls).toEqual([])
  })

  it('fails with what the server said when it refuses to prepare one', async () => {
    const fake = fakeServer({ media: [MKV] })
    fake.server.api.getDeviceDownload = async () => {
      throw new ApiError({ status: 409, message: 'An audio file has no copy' })
    }
    const { engine } = await fakeEngine({ server: fake, canPlay: () => false })
    await queueVideo({ engine, mediaId: 9 })
    await waitFor(() =>
      expect(engine.list()[0]?.status ?? null).toMatchObject({
        kind: DOWNLOAD_STATUS_KINDS.failed,
        message: 'An audio file has no copy',
      }),
    )
  })

  it('stops waiting for a copy when its download is paused', async () => {
    const fake = fakeServer({
      media: [MKV],
      files: { 9: bytesOfLength(12) },
      copies: { 9: [{ state: DEVICE_DOWNLOAD_STATES.preparing, progress: 0.1 }] },
    })
    const { engine } = await fakeEngine({ server: fake, canPlay: () => false })
    await queueVideo({ engine, mediaId: 9 })
    await waitFor(() => expect(fake.asked.copies[9] ?? 0).toBeGreaterThan(0))
    engine.pause(engine.list()[0]?.downloadId ?? '')
    await waitFor(() => expect(statusesOf(engine)).toEqual([DOWNLOAD_STATUS_KINDS.paused]))
    const asked = fake.asked.copies[9]
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(fake.asked.copies[9]).toBe(asked)
  })
})

describe('browser downloads: the index', () => {
  it('reads back what it wrote, through its guard', async () => {
    const disk = fakeDisk()
    const first = await fakeEngine({ server: server(), disk })
    await queueVideo({ engine: first.engine, mediaId: 7 })
    await untilAllReady(first.engine)
    await waitFor(async () =>
      expect(readIndex((await disk.textOf(INDEX_PATH)) ?? '')[0]?.status.kind ?? null).toBe(
        DOWNLOAD_STATUS_KINDS.ready,
      ),
    )
    const second = await fakeEngine({ server: server(), disk })
    expect(second.engine.list()).toEqual(first.engine.list())
    expect(second.engine.isSettled()).toBe(true)
  })

  it('reads a download cut off mid-flight as waiting, and leaves out what its guard refuses', () => {
    const disk = fakeDisk()
    const entry = {
      downloadId: 'aaaaaaaa-0000-4000-8000-000000000001',
      accountId: ACCOUNT,
      mediaId: 7,
      label: 'Busboys',
      group: { kind: DOWNLOAD_KINDS.movie, key: 'movie:7', title: 'Busboys', order: 0 },
      way: DOWNLOAD_WAYS.file,
      extension: CONTAINERS.mp4,
      size: 10,
      status: { kind: DOWNLOAD_STATUS_KINDS.downloading, bytes: 3 },
      createdAt: 1,
      artwork: { kind: DOWNLOAD_ARTWORK_KINDS.none },
      library: null,
      titleItemId: null,
      pictures: { art: null, logo: null, isComplete: true },
      subtitles: [],
      hasSubtitles: true,
      facts: { year: null, score: null, bitrate: null, pixels: null, addedAt: '', changedAt: '' },
      media: MOVIE,
      tracks: null,
      position: 0,
      duration: null,
    }
    const text = JSON.stringify({
      version: 1,
      entries: [entry, { ...entry, accountId: '../escape' }, { downloadId: 'nonsense' }],
    })
    expect(readIndex(text).map(({ status }) => status)).toEqual([
      { kind: DOWNLOAD_STATUS_KINDS.queued },
    ])
    expect(readIndex('not json')).toEqual([])
    expect(readIndex(JSON.stringify({ version: 2, entries: [entry] }))).toEqual([])
    expect(disk.names()).toEqual([])
  })

  it('takes up again a download a closed tab cut off, from the bytes that reached the disk', async () => {
    const disk = fakeDisk()
    const stuck = stuckAnswer(FILES[7].slice(0, 4))
    const fake = server()
    fake.answers.push(stuck.answer)
    const first = await fakeEngine({ server: fake, disk })
    await queueVideo({ engine: first.engine, mediaId: 7 })
    await waitFor(() =>
      expect(statusesOf(first.engine)).toEqual([DOWNLOAD_STATUS_KINDS.downloading]),
    )
    // The tab closes: nothing the open writer held reached the file.
    const again = server()
    const second = await fakeEngine({ server: again, disk })
    await untilAllReady(second.engine)
    expect(again.calls.map(({ from }) => from)).toEqual([0])
  })
})

describe('browser downloads: accounts', () => {
  it("shows an account its own downloads and no other's, and keeps the files of one that left", async () => {
    const fake = server()
    const { engine, disk } = await fakeEngine({ server: fake })
    await queueVideo({ engine, mediaId: 7 })
    await untilAllReady(engine)
    engine.setAccount(OTHER_ACCOUNT)
    expect(engine.list()).toEqual([])
    expect(engine.readyFor(7)).toBeNull()
    await queueVideo({ engine, mediaId: 7 })
    await untilAllReady(engine)
    expect(disk.names().filter((name) => name.endsWith('media.mp4'))).toHaveLength(2)
    engine.setAccount(null)
    expect(engine.list()).toEqual([])
    expect(disk.names().filter((name) => name.endsWith('media.mp4'))).toHaveLength(2)
    engine.setAccount(ACCOUNT)
    expect(engine.list()).toHaveLength(1)
    await engine.removeAll()
    expect(disk.names().filter((name) => name.endsWith('media.mp4'))).toEqual([
      expect.stringContaining(OTHER_ACCOUNT),
    ])
  })

  it('stops the run of an account that leaves, and takes it up when it is back', async () => {
    const stuck = stuckAnswer(FILES[7].slice(0, 4))
    const fake = server()
    fake.answers.push(stuck.answer)
    const { engine } = await fakeEngine({ server: fake })
    await queueVideo({ engine, mediaId: 7 })
    await waitFor(() => expect(statusesOf(engine)).toEqual([DOWNLOAD_STATUS_KINDS.downloading]))
    engine.setAccount(null)
    engine.setAccount(ACCOUNT)
    await untilAllReady(engine)
    expect(fake.calls.map(({ from }) => from)).toEqual([0, 4])
  })

  it('refuses a confirmation made after the account changed', async () => {
    const { engine } = await fakeEngine({ server: server() })
    const asked = await engine.ask(videoTarget(7))
    if (!asked.ok) throw new Error(asked.message)
    engine.setAccount(OTHER_ACCOUNT)
    expect(engine.confirm(asked.value.askId).ok).toBe(false)
  })
})

const track = (overrides: Partial<SubtitleTrack>): SubtitleTrack => ({
  id: 'external-0',
  source: SUBTITLE_SOURCES.external,
  codec: 'srt',
  language: 'en',
  title: null,
  default: false,
  forced: false,
  hearingImpaired: false,
  supported: true,
  ...overrides,
})

describe('browser downloads: pictures and subtitles', () => {
  const POSTER = new Blob(['poster'], { type: 'image/jpeg' })
  const LOGO = new Blob(['logo'], { type: 'image/png' })
  const ITEM = itemDetails({ id: 40, posterVersion: 'p1', logoVersion: 'l1' })

  it("saves a title's poster and title art once, and shows them by object URLs", async () => {
    const fake = server({ items: [ITEM], pictures: { '40:poster': POSTER, '40:logo': LOGO } })
    const { engine, disk, urls } = await fakeEngine({ server: fake })
    await queueVideo({ engine, mediaId: 7 })
    await untilAllReady(engine)
    const [view] = engine.list()
    expect(disk.names().filter((name) => name.includes('/pictures/item-40/'))).toHaveLength(2)
    expect(engine.pictureUrl(view?.pictures.art ?? '')).toStartWith('blob:fake/')
    expect(engine.pictureUrl(view?.pictures.logo ?? '')).toStartWith('blob:fake/')
    expect(urls.live.size).toBe(2)
    const playable = engine.playable(view?.downloadId ?? '')
    expect(playable).toMatchObject({ ok: true, value: { logo: { name: 'Busboys (2026)' } } })
    await engine.remove(view?.downloadId ?? '')
    expect(urls.live.size).toBe(0)
    expect(disk.names().some((name) => name.includes('/pictures/'))).toBe(false)
  })

  it("saves a title's pictures once when a fill and its download both want them", async () => {
    const fake = server({ items: [ITEM], pictures: { '40:poster': POSTER, '40:logo': LOGO } })
    const { engine, disk } = await fakeEngine({ server: fake })
    await queueVideo({ engine, mediaId: 7 })
    // The page says the server answers again, as it does on opening, while the download runs.
    engine.reconnected()
    await untilAllReady(engine)
    expect(disk.names().filter((name) => name.includes('/pictures/item-40/'))).toHaveLength(2)
  })

  it('reads the saved pictures back from disk for the next visit', async () => {
    const disk = fakeDisk()
    const fake = server({ items: [ITEM], pictures: { '40:poster': POSTER, '40:logo': LOGO } })
    const first = await fakeEngine({ server: fake, disk })
    await queueVideo({ engine: first.engine, mediaId: 7 })
    await untilAllReady(first.engine)
    await waitFor(async () =>
      expect(readIndex((await disk.textOf(INDEX_PATH)) ?? '')[0]?.status.kind ?? null).toBe(
        DOWNLOAD_STATUS_KINDS.ready,
      ),
    )
    const second = await fakeEngine({ server: server(), disk })
    const art = second.engine.list()[0]?.pictures.art ?? ''
    await waitFor(() => expect(second.engine.pictureUrl(art)).toStartWith('blob:fake/'))
  })

  it('downloads the video though a picture fails, and asks for it again later', async () => {
    const fake = server({ items: [ITEM], pictures: { '40:logo': LOGO } })
    const { engine } = await fakeEngine({ server: fake })
    await queueVideo({ engine, mediaId: 7 })
    await untilAllReady(engine)
    expect(engine.list()[0]?.pictures ?? null).toEqual({ art: null, logo: null })
    fake.server.picture = async ({ kind }) => (kind === ITEM_IMAGE_KINDS.poster ? POSTER : LOGO)
    engine.reconnected()
    await waitFor(() => expect(engine.list()[0]?.pictures.art ?? null).not.toBeNull())
    expect(engine.list()[0]?.pictures.logo ?? null).not.toBeNull()
  })

  it('keeps no picture of a kind the browser cannot name a file for', async () => {
    const odd = new Blob(['<svg/>'], { type: 'image/svg+xml' })
    const fake = server({ items: [ITEM], pictures: { '40:poster': odd, '40:logo': null } })
    const { engine } = await fakeEngine({ server: fake })
    await queueVideo({ engine, mediaId: 7 })
    await untilAllReady(engine)
    expect(engine.list()[0]?.pictures ?? null).toEqual({ art: null, logo: null })
  })

  it('saves each text subtitle as WebVTT, a sidecar whole and an embedded track by window', async () => {
    const tracks: MediaTracks = {
      audio: [],
      defaultAudio: null,
      frameRate: null,
      subtitles: [
        track({ id: 'embedded-0', source: SUBTITLE_SOURCES.embedded }),
        track({
          id: 'embedded-1',
          source: SUBTITLE_SOURCES.embedded,
          codec: 'hdmv_pgs_subtitle',
          supported: false,
        }),
        track({ id: 'external-0' }),
      ],
    }
    const fake = fakeServer({
      media: [mediaItem({ id: 7, container: CONTAINERS.mp4, size: 10, duration: 700, item: null })],
      files: FILES,
      tracks: { 7: tracks },
      cues: [{ start: 1, end: 2, text: 'Hello' }],
    })
    const { engine, disk } = await fakeEngine({ server: fake })
    await queueVideo({ engine, mediaId: 7 })
    await untilAllReady(engine)
    // The sidecar comes in one answer; the embedded track's 700 seconds are three windows.
    expect(fake.asked.cues).toEqual([
      'external-0:0',
      'embedded-0:0',
      'embedded-0:1',
      'embedded-0:2',
    ])
    expect(disk.names().filter((name) => name.endsWith('.vtt'))).toHaveLength(2)
    const id = engine.list()[0]?.downloadId ?? ''
    const playable = engine.playable(id)
    if (!playable.ok) throw new Error(playable.message)
    expect(playable.value.subtitles.map((each) => each.id)).toEqual(['external-0', 'embedded-0'])
    expect(await engine.cues({ downloadId: id, trackId: 'embedded-0' })).toEqual([
      { start: 1, end: 2, text: 'Hello' },
    ])
    expect(await engine.cues({ downloadId: id, trackId: 'embedded-9' })).toEqual([])
  })

  it('downloads the video though its subtitles cannot be read', async () => {
    const fake = server()
    fake.server.api.getTracks = async () => {
      throw new TypeError('Failed to fetch')
    }
    const { engine } = await fakeEngine({ server: fake })
    await queueVideo({ engine, mediaId: 7 })
    await untilAllReady(engine)
    expect(engine.playable(engine.list()[0]?.downloadId ?? '')).toMatchObject({
      ok: true,
      value: { subtitles: [] },
    })
  })
})

describe('browser downloads: playing', () => {
  it('opens a ready download as an object URL of its file, and lets go of it', async () => {
    const { engine, urls } = await fakeEngine({ server: server() })
    await queueVideo({ engine, mediaId: 7 })
    await untilAllReady(engine)
    const id = engine.readyFor(7) ?? ''
    expect(id).toBe(engine.list()[0]?.downloadId ?? 'none')
    const url = await engine.open(id)
    expect(url).toStartWith('blob:fake/')
    expect(urls.live.has(url ?? '')).toBe(true)
    engine.close(url ?? '')
    expect(urls.live.size).toBe(0)
    expect(await engine.open('aaaaaaaa-0000-4000-8000-999999999999')).toBeNull()
  })

  it('says why a download does not play: unknown, or not ready', async () => {
    const fake = server()
    fake.answers.push(statusAnswer(500))
    const { engine } = await fakeEngine({ server: fake })
    await queueVideo({ engine, mediaId: 7 })
    await waitFor(() => expect(statusesOf(engine)).toEqual([DOWNLOAD_STATUS_KINDS.failed]))
    expect(engine.playable(engine.list()[0]?.downloadId ?? '')).toEqual({
      ok: false,
      message: BROWSER_DOWNLOAD_COPY.notReady,
    })
    expect(engine.playable('nope')).toEqual({ ok: false, message: BROWSER_DOWNLOAD_COPY.unknown })
  })

  it('keeps where the viewer left a download, and how much of it that is', async () => {
    const disk = fakeDisk()
    const { engine } = await fakeEngine({ server: server(), disk })
    await queueVideo({ engine, mediaId: 7 })
    await untilAllReady(engine)
    const id = engine.list()[0]?.downloadId ?? ''
    engine.savePosition({ downloadId: id, position: 30, duration: 120 })
    expect(engine.list()[0]?.watched ?? null).toBe(0.25)
    expect(engine.playable(id)).toMatchObject({ ok: true, value: { resumeAt: 30 } })
    engine.savePosition({ downloadId: 'nope', position: 1, duration: null })
    await waitFor(async () =>
      expect(readIndex((await disk.textOf(INDEX_PATH)) ?? '')[0]?.position ?? null).toBe(30),
    )
  })

  it('reads the room its downloads take and the browser has left', async () => {
    const { engine } = await fakeEngine({ server: server(), disk: fakeDisk({ quota: 1000 }) })
    await queueVideo({ engine, mediaId: 7 })
    await untilAllReady(engine)
    const space = await engine.space()
    expect(space.total).toBe(1000)
    expect(space.used).toBe(10)
    expect(space.free).toBeLessThan(1000)
  })
})

describe('browser downloads: titles', () => {
  const show = { id: 4, title: 'Severance' }
  type PrimaryOf = (number: number) => MediaItem

  const episode: PrimaryOf = (number) =>
    mediaItem({
      id: 20 + number,
      container: CONTAINERS.mp4,
      size: 4,
      libraryId: 3,
      item: itemSummary({
        id: 50 + number,
        type: ITEM_TYPES.episode,
        title: `Part ${number}`,
        show,
        season: 1,
        episode: number,
      }),
    })
  const seasonOf = (primaryOf: PrimaryOf) =>
    itemDetails({
      id: 5,
      type: ITEM_TYPES.season,
      title: 'Season 1',
      show,
      season: 1,
      posterVersion: 's1',
      children: [2, 1].map((number) => ({
        ...itemSummary({ id: 50 + number, title: `Part ${number}`, show, season: 1 }),
        type: ITEM_TYPES.episode,
        episode: number,
        summary: null,
        released: null,
        runtime: null,
        stillVersion: null,
        watched: false,
        primary: primaryOf(number),
      })),
    })

  it('queues every episode of a season under its show, in order, each with its library', async () => {
    const season = seasonOf(episode)
    const fake = fakeServer({
      items: [season, itemDetails({ id: 4, posterVersion: null, logoVersion: null })],
      libraries: [
        library({ id: 3, name: 'Shows', settings: { ...library().settings, locked: true } }),
      ],
      files: { 21: bytesOfLength(4), 22: bytesOfLength(4) },
    })
    const { engine } = await fakeEngine({ server: fake })
    const asked = await engine.ask({ kind: DOWNLOAD_TARGET_KINDS.item, itemId: 5 })
    if (!asked.ok) throw new Error(asked.message)
    expect(asked.value.status).toMatchObject({
      downloadKind: DOWNLOAD_KINDS.season,
      files: 2,
      bytes: 8,
    })
    engine.confirm(asked.value.askId)
    await untilAllReady(engine)
    expect(
      engine.list().map(({ label, group, library: from, artwork }) => ({
        label,
        key: group.key,
        order: group.order,
        from,
        artwork,
      })),
    ).toEqual([
      {
        label: 'S01E02 Part 2',
        key: 'show:4',
        order: 10_002,
        from: { id: 3, name: 'Shows', isPrivate: true },
        artwork: { kind: DOWNLOAD_ARTWORK_KINDS.poster, itemId: 5, version: 's1' },
      },
      {
        label: 'S01E01 Part 1',
        key: 'show:4',
        order: 10_001,
        from: { id: 3, name: 'Shows', isPrivate: true },
        artwork: { kind: DOWNLOAD_ARTWORK_KINDS.poster, itemId: 5, version: 's1' },
      },
    ])
  })

  it('leaves the Dolby Vision only episodes out of a season where the browser does not play them', async () => {
    const season = seasonOf((number) => ({ ...episode(number), isDolbyVisionOnly: number === 2 }))
    const fake = fakeServer({
      items: [season, itemDetails({ id: 4, posterVersion: null, logoVersion: null })],
      libraries: [library({ id: 3, name: 'Shows' })],
      files: { 21: bytesOfLength(4), 22: bytesOfLength(4) },
    })
    const { engine } = await fakeEngine({
      server: fake,
      canPlay: (mimeType) => !mimeType.includes('dvh1'),
    })
    const asked = await engine.ask({ kind: DOWNLOAD_TARGET_KINDS.item, itemId: 5 })
    if (!asked.ok) throw new Error(asked.message)
    expect(asked.value.status).toMatchObject({ files: 1, bytes: 4 })
    engine.confirm(asked.value.askId)
    await untilAllReady(engine)
    expect(engine.list().map(({ label }) => label)).toEqual(['S01E01 Part 1'])
  })
})
