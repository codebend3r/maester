import {
  type CanPlay,
  type DeviceDownload,
  DEVICE_DOWNLOAD_STATES,
  DOWNLOAD_STATUS_KINDS,
  DOWNLOAD_TARGET_KINDS,
  type DownloadAsk,
  type DownloadTarget,
  type ItemDetails,
  type Library,
  type MediaItem,
  type MediaTracks,
  type Saga,
  type SubtitleCue,
} from '@raven/core'
import { expect, mock } from 'bun:test'
import { waitFor } from '@testing-library/react'
import type { DownloadClock } from '@/browserDownloads/clock'
import { DiskFullError, type DiskPath, type DownloadDisk } from '@/browserDownloads/disk'
import { type BrowserDownloads, createBrowserDownloads } from '@/browserDownloads/engine'
import { browserDownloadsHost } from '@/browserDownloads/host'
import { HTTP_STATUSES } from '@shared/http'
import type { BytesAnswer, DownloadServer } from '@/browserDownloads/server'
import { browserTabs, type DownloadTabs, type TabMessage } from '@/browserDownloads/tabs'
import { useBrowserDownloads } from '@/stores/browserDownloads'
import { useDownloadsHostStore } from '@/stores/downloadsHost'
import { library as libraryFixture } from '@/test/fixtures'
import { HEADERS } from '@shared/http'

export const ACCOUNT = '11111111-1111-4111-8111-111111111111'
export const OTHER_ACCOUNT = '22222222-2222-4222-8222-222222222222'

const keyOf = (path: DiskPath): string => path.join('/')

type FakeDiskProps = {
  quota?: number
  /** The most bytes one file takes before the disk says it is full; none by default. */
  fullAt?: number | null
}

/** A disk of blobs in a map. A writer's bytes join its file only on `commit` or `close`, as OPFS's do. */
export const fakeDisk = ({ quota = 1_000_000, fullAt = null }: FakeDiskProps = {}) => {
  const files = new Map<string, Blob>()
  const limits = { fullAt }
  const disk: DownloadDisk = {
    size: async (path) => files.get(keyOf(path))?.size ?? 0,
    open: async ({ path, from }) => {
      const key = keyOf(path)
      const kept = (files.get(key) ?? new Blob([])).slice(0, from)
      files.set(key, kept)
      const pending: Uint8Array<ArrayBuffer>[] = []
      const flush = async () => {
        files.set(key, new Blob([files.get(key) ?? new Blob([]), ...pending.splice(0)]))
      }
      return {
        write: async (chunk) => {
          const size =
            (files.get(key)?.size ?? 0) +
            pending.reduce((sum, each) => sum + each.byteLength, 0) +
            chunk.byteLength
          if (limits.fullAt !== null && size > limits.fullAt) throw new DiskFullError()
          pending.push(new Uint8Array(chunk))
        },
        commit: flush,
        close: flush,
      }
    },
    write: async ({ path, data }) => {
      files.set(keyOf(path), typeof data === 'string' ? new Blob([data]) : data)
    },
    read: async (path) => files.get(keyOf(path)) ?? null,
    remove: async (path) => {
      const key = keyOf(path)
      ;[...files.keys()]
        .filter((name) => name === key || name.startsWith(`${key}/`))
        .forEach((name) => files.delete(name))
    },
    space: async () => ({
      usage: [...files.values()].reduce((sum, blob) => sum + blob.size, 0),
      quota,
    }),
    persist: mock(async () => {}),
  }
  return {
    disk,
    files,
    limits,
    names: () => [...files.keys()].toSorted(),
    textOf: async (path: DiskPath) => (await files.get(keyOf(path))?.text()) ?? null,
  }
}

type FakeTimer = { at: number; run: () => void }

/**
 * A clock a test moves by hand. A sleep takes one turn of the event loop and moves it on by what
 * it was asked; a timer runs only when `advance` reaches it.
 */
export const fakeClock = () => {
  const state = { now: 1_700_000_000_000 }
  const slept: number[] = []
  const timers = new Set<FakeTimer>()
  const clock: DownloadClock = {
    now: () => state.now,
    sleep: async ({ ms }) => {
      slept.push(ms)
      state.now += ms
      // A turn of the event loop, so a poll that never ends still lets the test go on.
      await new Promise((resolve) => setTimeout(resolve, 0))
    },
    after: ({ ms, run }) => {
      const timer = { at: state.now + ms, run }
      timers.add(timer)
      return () => {
        timers.delete(timer)
      }
    },
  }
  /** Moves the clock on by `ms` and runs the timers that came due. */
  const advance = (ms: number): void => {
    state.now += ms
    const due = [...timers].filter(({ at }) => at <= state.now)
    due.forEach((timer) => {
      timers.delete(timer)
      timer.run()
    })
  }
  return { clock, state, slept, timers, advance }
}

type FakeTab = {
  onHeld: (() => void) | null
  listener: ((message: TabMessage) => void) | null
  isOpen: boolean
}

/**
 * The tabs of one browser, as the Web Locks API and a broadcast channel join them: the first to
 * ask holds the queue until it closes, the index is one tab's at a time, and what a tab says
 * reaches every other, a moment later.
 */
export const fakeTabs = () => {
  const opened: FakeTab[] = []
  const state: { holder: FakeTab | null; turn: Promise<unknown> } = {
    holder: null,
    turn: Promise.resolve(),
  }
  const grant = (): void => {
    if (state.holder !== null) return
    const next = opened.find((tab) => tab.isOpen && tab.onHeld !== null)
    if (next === undefined) return
    state.holder = next
    next.onHeld?.()
  }
  const open = () => {
    const tab: FakeTab = { onHeld: null, listener: null, isOpen: true }
    opened.push(tab)
    const tabs: DownloadTabs = {
      holdQueue: (onHeld) => {
        tab.onHeld = onHeld
        grant()
      },
      withIndex: (task) => {
        const run = state.turn.then(task, task)
        state.turn = run.catch(() => undefined)
        return run
      },
      announce: (message) =>
        opened
          .filter((other) => other !== tab && other.isOpen)
          .forEach((other) =>
            queueMicrotask(() => {
              other.listener?.(message)
            }),
          ),
      listen: (listener) => {
        tab.listener = listener
      },
    }
    /** Closes the tab: it hears no more, and the queue it held goes to the next that asked. */
    const close = (): void => {
      tab.isOpen = false
      if (state.holder !== tab) return
      state.holder = null
      grant()
    }
    return { tabs, close }
  }
  return { open }
}

export const bytesOfLength = (length: number): Uint8Array<ArrayBuffer> =>
  Uint8Array.from({ length }, (_, index) => index % 251)

const CHUNK = 4

type RangedProps = { bytes: Uint8Array; from: number }

/** A whole file from 0, or the rest of it from `from` as a 206, a few bytes a chunk. */
export const rangedAnswer = ({ bytes, from }: RangedProps): BytesAnswer => {
  const rest = bytes.slice(from)
  const chunks = Array.from({ length: Math.ceil(rest.byteLength / CHUNK) }, (_, index) =>
    rest.slice(index * CHUNK, (index + 1) * CHUNK),
  )
  const headers = new Map<string, string>(
    from > 0
      ? [[HEADERS.contentRange, `bytes ${from}-${bytes.byteLength - 1}/${bytes.byteLength}`]]
      : [[HEADERS.contentLength, String(bytes.byteLength)]],
  )
  return {
    status: from > 0 ? HTTP_STATUSES.partialContent : HTTP_STATUSES.ok,
    headers: { get: (name) => headers.get(name) ?? null },
    body: new ReadableStream<Uint8Array>({
      start: (controller) => {
        chunks.forEach((chunk) => controller.enqueue(chunk))
        controller.close()
      },
    }),
  }
}

export const statusAnswer = (status: number): BytesAnswer => ({
  status,
  headers: { get: () => null },
  body: null,
})

/** An answer whose body sends `first` and then nothing, until the test ends it or its fetch is stopped. */
export const stuckAnswer = (first: Uint8Array) => {
  const held: { controller: ReadableStreamDefaultController<Uint8Array> | null } = {
    controller: null,
  }
  const answer: BytesAnswer = {
    status: HTTP_STATUSES.ok,
    headers: { get: () => null },
    body: new ReadableStream<Uint8Array>({
      start: (controller) => {
        held.controller = controller
        controller.enqueue(first)
      },
    }),
  }
  return {
    answer,
    /** Ends the body short, as a server that cut the response does. */
    cut: () => {
      held.controller?.error(new TypeError('The connection was lost.'))
    },
    /** Sends more of the body, and leaves it open. */
    send: (chunk: Uint8Array) => {
      held.controller?.enqueue(chunk)
    },
    finish: (rest: Uint8Array) => {
      held.controller?.enqueue(rest)
      held.controller?.close()
    },
  }
}

type BytesCall = { mediaId: number; way: string; from: number; isFresh: boolean }

type FakeServerProps = {
  media?: MediaItem[]
  items?: ItemDetails[]
  sagas?: Record<number, Saga[]>
  libraries?: Library[]
  tracks?: Record<number, MediaTracks>
  /** Each video's bytes, the original's and any copy's alike. */
  files?: Record<number, Uint8Array>
  /** What `prepare` answers for a video, one answer an ask, the last one from then on. */
  copies?: Record<number, DeviceDownload[]>
  cues?: SubtitleCue[]
  pictures?: Record<string, Blob | null>
}

type CopyAsk = { mediaId: number }

type PictureAsk = { itemId: number; kind: string }

const NO_TRACKS: MediaTracks = { audio: [], subtitles: [], defaultAudio: null, frameRate: null }

/** The server as a table. `answers` queues what `bytes` says next, ahead of the files' own bytes. */
export const fakeServer = ({
  media = [],
  items = [],
  sagas = {},
  libraries = [libraryFixture()],
  tracks = {},
  files = {},
  copies = {},
  cues = [],
  pictures = {},
}: FakeServerProps = {}) => {
  const answers: Array<BytesAnswer | Error> = []
  const calls: BytesCall[] = []
  const asked: { copies: Record<number, number>; cues: string[] } = { copies: {}, cues: [] }
  const missing = (what: string) => new Error(`The fake server has no ${what}.`)
  const server: DownloadServer = {
    api: {
      getMedia: mock(async (id: number) => {
        const found = media.find((each) => each.id === id)
        if (found === undefined) throw missing(`media ${id}`)
        return found
      }),
      getItem: mock(async (id: number) => {
        const found = items.find((each) => each.id === id)
        if (found === undefined) throw missing(`item ${id}`)
        return found
      }),
      listSagas: mock(async (libraryId: number) => sagas[libraryId] ?? []),
      getLibrary: mock(async (id: number) => {
        const found = libraries.find((each) => each.id === id)
        if (found === undefined) throw missing(`library ${id}`)
        return found
      }),
      getTracks: mock(async (id: number) => tracks[id] ?? NO_TRACKS),
      getDeviceDownload: mock(async ({ mediaId }: CopyAsk) => {
        const list = copies[mediaId] ?? []
        const index = asked.copies[mediaId] ?? 0
        asked.copies[mediaId] = index + 1
        return (
          list[Math.min(index, list.length - 1)] ?? {
            state: DEVICE_DOWNLOAD_STATES.ready,
            bytes: files[mediaId]?.byteLength ?? 0,
          }
        )
      }),
    },
    bytes: async ({ mediaId, way, from, isFresh }) => {
      calls.push({ mediaId, way, from, isFresh })
      const next = answers.shift()
      if (next instanceof Error) throw next
      if (next !== undefined) return next
      const bytes = files[mediaId]
      return bytes === undefined
        ? statusAnswer(HTTP_STATUSES.notFound)
        : rangedAnswer({ bytes, from })
    },
    picture: mock(async ({ itemId, kind }: PictureAsk) => {
      const picture = pictures[`${itemId}:${kind}`]
      if (picture === undefined) throw new TypeError('The picture could not be fetched.')
      return picture
    }),
    cues: async ({ trackId, window }) => {
      asked.cues.push(`${trackId}:${window}`)
      return cues
    },
  }
  return { server, answers, calls, asked }
}

type FakeEngineProps = {
  disk?: ReturnType<typeof fakeDisk>
  server?: ReturnType<typeof fakeServer>
  clock?: ReturnType<typeof fakeClock>
  canPlay?: CanPlay
  account?: string | null
  /** The tabs the engine shares its disk with; alone by default, as in a browser with no locks. */
  tabs?: DownloadTabs
  /** The first id it hands out, so two engines over one disk name nothing alike. */
  firstId?: number
}

/** An engine over fakes, started and signed in as `account`, with its object URLs counted. */
export const fakeEngine = async ({
  disk = fakeDisk(),
  server = fakeServer(),
  clock = fakeClock(),
  canPlay = () => true,
  account = ACCOUNT,
  tabs = browserTabs({ navigator: {} }),
  firstId = 1,
}: FakeEngineProps = {}) => {
  const ids = { next: firstId }
  const urls = { live: new Set<string>(), made: 0 }
  const engine: BrowserDownloads = createBrowserDownloads({
    disk: disk.disk,
    server: server.server,
    clock: clock.clock,
    canPlay,
    urls: {
      create: () => {
        urls.made += 1
        const url = `blob:fake/${urls.made}`
        urls.live.add(url)
        return url
      },
      revoke: (url) => {
        urls.live.delete(url)
      },
    },
    newId: () => {
      const id = `aaaaaaaa-0000-4000-8000-${String(ids.next).padStart(12, '0')}`
      ids.next += 1
      return id
    },
    tabs,
  })
  await engine.start()
  engine.setAccount(account)
  return { engine, disk, server, clock, urls }
}

/** Runs the page as a browser that keeps downloads, as `startBrowserDownloads` sets it: its host is `engine`. */
export const asBrowserDownloads = (engine: BrowserDownloads): void => {
  useBrowserDownloads.setState({ engine })
  useDownloadsHostStore.setState({ host: browserDownloadsHost(engine) })
}

type ReadyDownloadProps = FakeEngineProps & { mediaId: number }

/** A browser with one video downloaded and ready; answers the engine's fakes and the download's id. */
export const withReadyDownload = async ({ mediaId, ...props }: ReadyDownloadProps) => {
  const fake = await fakeEngine(props)
  const asked = await fake.engine.ask({ kind: DOWNLOAD_TARGET_KINDS.media, mediaId })
  if (!asked.ok) throw new Error(asked.message)
  fake.engine.confirm(asked.value.askId)
  const settled = async (): Promise<string> => {
    const downloadId = fake.engine.readyFor(mediaId)
    if (downloadId !== null) return downloadId
    await new Promise((resolve) => setTimeout(resolve, 1))
    return settled()
  }
  const downloadId = await settled()
  asBrowserDownloads(fake.engine)
  return { ...fake, downloadId }
}

export const videoTarget = (mediaId: number): DownloadTarget => ({
  kind: DOWNLOAD_TARGET_KINDS.media,
  mediaId,
})

type QueueVideoProps = { engine: BrowserDownloads; mediaId: number }

/** Asks for a video and confirms it, as the dialog's Download does. */
export const queueVideo = async ({ engine, mediaId }: QueueVideoProps): Promise<DownloadAsk> => {
  const asked = await engine.ask(videoTarget(mediaId))
  if (!asked.ok) throw new Error(asked.message)
  engine.confirm(asked.value.askId)
  return asked.value
}

export const statusesOf = (engine: BrowserDownloads) =>
  engine.list().map(({ status }) => status.kind)

export const untilAllReady = (engine: BrowserDownloads) =>
  waitFor(() =>
    expect(statusesOf(engine).every((kind) => kind === DOWNLOAD_STATUS_KINDS.ready)).toBe(true),
  )
