import {
  type CanPlay,
  DOWNLOAD_STATUS_KINDS,
  type DownloadAsk,
  type DownloadStatus,
  type DownloadTarget,
  type DownloadView,
  isMediaItem,
  type MediaItem,
  type SpaceView,
  type SubtitleCue,
  type SubtitleTrack,
} from '@raven/core'
import { type Answer, createDownloadAsks } from '@/browserDownloads/asks'
import type { DownloadClock } from '@/browserDownloads/clock'
import { BROWSER_DOWNLOAD_COPY } from '@/browserDownloads/copy'
import type { DownloadDisk } from '@/browserDownloads/disk'
import {
  type BrowserEntry,
  bytesOf,
  folderOf,
  isUnderWay,
  mediaPathOf,
  viewOf,
} from '@/browserDownloads/entries'
import { fetchBytes } from '@/browserDownloads/fetchBytes'
import { ABORTED, OUTCOMES, type Outcome, outcomeOfError, READY } from '@/browserDownloads/outcomes'
import { createDownloadPictures, type ObjectUrls } from '@/browserDownloads/pictures'
import { prepareCopy } from '@/browserDownloads/prepareCopy'
import type { DownloadServer } from '@/browserDownloads/server'
import { keepsDolbyVision } from '@/browserDownloads/ways'
import { createDownloadStore } from '@/browserDownloads/store'
import { createDownloadSubtitles, type ReadCuesProps } from '@/browserDownloads/subtitles'
import {
  type DownloadTabs,
  type Running,
  TAB_MESSAGES,
  type TabMessage,
} from '@/browserDownloads/tabs'

/** How often the page hears of a download's progress, at most. */
const PROGRESS_MS = 250

export type BrowserDownloadsDeps = {
  disk: DownloadDisk
  server: DownloadServer
  clock: DownloadClock
  canPlay: CanPlay
  urls: ObjectUrls
  newId: () => string
  tabs: DownloadTabs
}

/** What the page hears when the downloads change: the list, and each server copy's progress. */
export type DownloadsNews = {
  downloads: DownloadView[]
  /** How far along the server's copy of each download is, from 0 to 1, by `downloadId`. */
  preparing: Readonly<Record<string, number>>
}

/** A ready download as the player opens it. */
export type PlayableDownload = {
  downloadId: string
  label: string
  /** The title the header names: the show's for an episode. */
  title: string
  logo: { url: string; name: string } | null
  /** The video as the server described it; null when it reads as nothing this build knows. */
  media: MediaItem | null
  resumeAt: number
  subtitles: SubtitleTrack[]
}

type DownloadsListener = (change: DownloadsNews) => void

type Unsubscribe = () => void

type SavePositionProps = { downloadId: string; position: number; duration: number | null }

export type BrowserDownloads = {
  /** Whether a Dolby Vision only title downloads here: only in a browser that plays it. */
  canKeepDolbyVision: boolean
  /** Reads the index, and takes the queue when no other tab holds it. Until it has read, the list is empty. */
  start: () => Promise<void>
  /** Whether the index is read and the page has said whose downloads to show: the list is whole. */
  isSettled: () => boolean
  /** Whose downloads show and run: the signed-in account's, or nobody's. */
  setAccount: (accountId: string | null) => void
  subscribe: (listener: DownloadsListener) => Unsubscribe
  list: () => DownloadView[]
  ask: (target: DownloadTarget) => Promise<Answer<DownloadAsk>>
  confirm: (askId: string) => Answer<DownloadView[]>
  decline: (askId: string) => void
  pause: (downloadId: string) => void
  resume: (downloadId: string) => void
  remove: (downloadId: string) => Promise<void>
  pauseAll: () => void
  resumeAll: () => void
  removeAll: () => Promise<void>
  /** Queues again what a lost connection stopped, once the server answers. */
  reconnected: () => void
  space: () => Promise<SpaceView>
  /** The object URL of a saved picture; null until it is read from disk. */
  pictureUrl: (pictureId: string) => string | null
  playable: (downloadId: string) => Answer<PlayableDownload>
  /** An object URL of the video's file, backed by the disk, which the caller hands back to `close`. */
  open: (downloadId: string) => Promise<string | null>
  close: (url: string) => void
  cues: (input: ReadCuesProps) => Promise<SubtitleCue[]>
  /** The ready download of a video, for a watch page that cannot reach the server. */
  readyFor: (mediaId: number) => string | null
  savePosition: (input: SavePositionProps) => void
}

/** The one download on its way: `bytes` once its file answers, `preparing` while the server makes its copy. */
type Run = Omit<Running, 'downloadId'> & {
  downloadId: string
  abort: AbortController
  done: Promise<void>
}

type RunEntryProps = { run: Run; signal: AbortSignal }

type SetStatusProps = { downloadId: string; status: DownloadStatus }

type SettleProps = { run: Run; outcome: Outcome }

type IsQueuedProps = Pick<BrowserEntry, 'status'>

const isQueued = ({ status }: IsQueuedProps): boolean =>
  status.kind === DOWNLOAD_STATUS_KINDS.queued

/**
 * The browser's downloads: the asks, the queue and what the page reads of them, over the index
 * (`store.ts`), the files (`fetchBytes.ts`), the pictures and the subtitles, with the disk, the
 * server, the clock and the tabs handed in. One file downloads at a time, in the order it was
 * confirmed, in the one tab that holds the queue, and only for the account signed in; every other
 * account's files stay on disk, unlisted.
 */
export const createBrowserDownloads = ({
  disk,
  server,
  clock,
  canPlay,
  urls,
  newId,
  tabs,
}: BrowserDownloadsDeps): BrowserDownloads => {
  const store = createDownloadStore({ disk, tabs })
  const pictures = createDownloadPictures({ disk, server, urls, newId, store })
  const subtitles = createDownloadSubtitles({ disk, server, store })
  const state: {
    run: Run | null
    /** What the tab that holds the queue last said of its run, in a tab that does not. */
    heard: Running | null
    /** Whether this tab holds the queue: it alone downloads, and fetches what the downloads lack. */
    isRunner: boolean
    woken: Promise<void>
    toldAt: number
    isRead: boolean
    hasAccount: boolean
  } = {
    run: null,
    heard: null,
    isRunner: false,
    woken: Promise.resolve(),
    toldAt: 0,
    isRead: false,
    hasAccount: false,
  }
  const stalled = new Set<string>()
  const listeners = new Set<DownloadsListener>()

  /** The download on its way, here or in the tab that holds the queue; a stopped run is none. */
  const running = (): Running | null => {
    if (!state.isRunner) return state.heard
    const { run } = state
    if (run === null || run.abort.signal.aborted) return null
    return { downloadId: run.downloadId, bytes: run.bytes, preparing: run.preparing }
  }

  /** The account's downloads as they stand: the index names none as on its way, so the run says which is. */
  const shown = (): BrowserEntry[] => {
    const now = running()
    return store.own().map((entry) => {
      const isOnItsWay = now !== null && now.downloadId === entry.downloadId && isQueued(entry)
      const bytes = isOnItsWay ? now.bytes : null
      return bytes === null
        ? entry
        : { ...entry, status: { kind: DOWNLOAD_STATUS_KINDS.downloading, bytes } }
    })
  }

  const list = (): DownloadView[] => shown().map(viewOf)

  const asks = createDownloadAsks({ disk, server, clock, canPlay, newId, store, shown })

  const tell = (): void => {
    state.toldAt = clock.now()
    const now = running()
    if (state.isRunner) tabs.announce({ kind: TAB_MESSAGES.running, running: now })
    const preparing = now?.preparing ?? null
    const change = {
      downloads: list(),
      preparing: now === null || preparing === null ? {} : { [now.downloadId]: preparing },
    }
    listeners.forEach((listener) => listener(change))
  }

  const setStatus = ({ downloadId, status }: SetStatusProps): void => {
    store.patch({ downloadId, patch: { status } })
    tell()
  }

  const settle = ({ run, outcome }: SettleProps): void => {
    const { downloadId } = run
    const bytes = run.bytes ?? 0
    switch (outcome.kind) {
      case OUTCOMES.aborted:
        return
      case OUTCOMES.ready:
        return setStatus({ downloadId, status: { kind: DOWNLOAD_STATUS_KINDS.ready } })
      case OUTCOMES.failed:
        return setStatus({
          downloadId,
          status: { kind: DOWNLOAD_STATUS_KINDS.failed, bytes, message: outcome.message },
        })
      case OUTCOMES.paused:
        return setStatus({
          downloadId,
          status: { kind: DOWNLOAD_STATUS_KINDS.paused, bytes, message: outcome.message },
        })
      case OUTCOMES.stalled:
        stalled.add(downloadId)
        return setStatus({
          downloadId,
          status: {
            kind: DOWNLOAD_STATUS_KINDS.paused,
            bytes,
            message: BROWSER_DOWNLOAD_COPY.outage,
          },
        })
      default: {
        const unreachable: never = outcome
        return unreachable
      }
    }
  }

  /** One download from start to finish: the server's copy, the pictures, the bytes, the subtitles. */
  const runEntry = async ({ run, signal }: RunEntryProps): Promise<Outcome> => {
    const { downloadId } = run
    const onSize = (size: number): void => store.patch({ downloadId, patch: { size } })
    try {
      const asked = store.entryOf(downloadId)
      if (asked === null) return ABORTED
      const refused = await prepareCopy({
        server,
        clock,
        entry: asked,
        signal,
        onSize,
        onProgress: (progress) => {
          run.preparing = progress
          tell()
        },
      })
      if (refused !== null) return refused
      await pictures.save(downloadId).catch(() => undefined)
      const entry = store.entryOf(downloadId)
      if (entry === null) return ABORTED
      const fetched = await fetchBytes({
        disk,
        server,
        clock,
        entry,
        signal,
        isRetry: false,
        onSize,
        // A chunk that lands after its run was stopped says nothing: the status is the stopper's.
        onProgress: (bytes) => {
          if (signal.aborted) return
          run.bytes = bytes
          if (clock.now() - state.toldAt >= PROGRESS_MS) tell()
        },
      })
      if (fetched.kind !== OUTCOMES.ready) return fetched
      await subtitles.save({ downloadId, signal }).catch(() => undefined)
      return signal.aborted ? ABORTED : READY
    } catch (error) {
      return signal.aborted ? ABORTED : outcomeOfError(error)
    }
  }

  const pump = (): void => {
    if (!state.isRunner || state.run !== null || store.account() === null) return
    const next = store.own().find(isQueued)
    if (next === undefined) return
    const abort = new AbortController()
    const run: Run = {
      downloadId: next.downloadId,
      bytes: null,
      preparing: null,
      abort,
      done: Promise.resolve(),
    }
    state.run = run
    run.done = runEntry({ run, signal: abort.signal }).then((outcome) => {
      settle({ run, outcome })
      if (state.run === run) state.run = null
      // The run is over: the page and the other tabs stop hearing of it.
      tell()
      pump()
    })
  }

  /** Stops the run of a download, if it is the one running, and answers once its file is closed. */
  const stop = (downloadId: string): Promise<void> => {
    const { run } = state
    if (run === null || run.downloadId !== downloadId) return Promise.resolve()
    run.abort.abort()
    return run.done
  }

  /** Asks again for the pictures a download could not get when it ran, in the tab that holds the queue. */
  const fillPictures = async (): Promise<void> => {
    if (state.isRunner && (await pictures.fill())) tell()
  }

  /** Once the list or the account changed: the pictures to show, those still owed, then the queue. */
  const wake = (): void => {
    state.woken = state.woken
      .then(async () => {
        if (await pictures.load()) tell()
        await fillPictures()
      })
      .catch(() => undefined)
      .finally(pump)
  }

  const removeFiles = async (entry: BrowserEntry): Promise<void> => {
    await stop(entry.downloadId)
    await disk.remove(folderOf(entry)).catch(() => undefined)
    await pictures.removeOf(entry)
  }

  const drop = async (dropped: readonly BrowserEntry[]): Promise<void> => {
    const ids = new Set(dropped.map(({ downloadId }) => downloadId))
    store.change((entries) => entries.filter(({ downloadId }) => !ids.has(downloadId)))
    ids.forEach((downloadId) => stalled.delete(downloadId))
    pictures.drop()
    tell()
    await dropped.reduce<Promise<void>>(async (previous, entry) => {
      await previous
      await removeFiles(entry)
    }, Promise.resolve())
    pump()
  }

  const pause = (downloadId: string): void => {
    const entry = shown().find((each) => each.downloadId === downloadId) ?? null
    if (entry === null || !isUnderWay(entry.status)) return
    const bytes = bytesOf(entry)
    stop(downloadId).catch(() => undefined)
    setStatus({
      downloadId,
      status: { kind: DOWNLOAD_STATUS_KINDS.paused, bytes, message: null },
    })
  }

  const requeue = (downloadId: string): void => {
    stalled.delete(downloadId)
    setStatus({ downloadId, status: { kind: DOWNLOAD_STATUS_KINDS.queued } })
  }

  const resume = (downloadId: string): void => {
    const kind = store.entryOf(downloadId)?.status.kind ?? null
    if (kind !== DOWNLOAD_STATUS_KINDS.paused && kind !== DOWNLOAD_STATUS_KINDS.failed) return
    requeue(downloadId)
    pump()
  }

  /*
   * What another tab did to the download this one is on: deleted it, so its run stops and its
   * file, which only this tab could let go of, goes; or paused it, so its run stops.
   */
  const followRun = async (before: readonly BrowserEntry[]): Promise<void> => {
    const { run } = state
    if (run === null) return
    const entry = store.all().find(({ downloadId }) => downloadId === run.downloadId) ?? null
    const removed = before.find(({ downloadId }) => downloadId === run.downloadId) ?? null
    if (entry === null && removed !== null) return removeFiles(removed)
    if (entry !== null && !isQueued(entry)) run.abort.abort()
  }

  /** Reads the index: at the start, on taking the queue, and whenever another tab says it changed. */
  const reread = async (): Promise<void> => {
    const before = store.all()
    await store.refresh()
    state.isRead = true
    pictures.drop()
    tell()
    if (state.isRunner) await followRun(before)
    wake()
  }

  const hear = (message: TabMessage): void => {
    switch (message.kind) {
      case TAB_MESSAGES.running:
        if (state.isRunner) return
        state.heard = message.running
        return tell()
      case TAB_MESSAGES.index:
        reread().catch(() => undefined)
        return
      default: {
        const unreachable: never = message
        return unreachable
      }
    }
  }

  return {
    start: async () => {
      tabs.listen(hear)
      tabs.holdQueue(() => {
        state.isRunner = true
        state.heard = null
        // A tab that takes the queue over reads what the last one left; the first read is below.
        if (state.isRead) reread().catch(() => undefined)
      })
      await reread()
    },
    isSettled: () => state.isRead && state.hasAccount,
    canKeepDolbyVision: keepsDolbyVision(canPlay),
    setAccount: (accountId) => {
      const isFirst = !state.hasAccount
      state.hasAccount = true
      if (accountId === store.account()) return isFirst ? tell() : undefined
      // The account that left keeps its files; its run stops, and takes up again when it is back.
      const { run } = state
      run?.abort.abort()
      store.setAccount(accountId)
      asks.clear()
      pictures.drop()
      tell()
      const settled = run === null ? Promise.resolve() : run.done
      settled.then(wake).catch(() => undefined)
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    list,
    ask: asks.ask,
    confirm: (askId) => {
      const fresh = asks.confirm(askId)
      if (fresh === null) return { ok: false, message: BROWSER_DOWNLOAD_COPY.askGone }
      const isFirst = store.all().length === 0
      // A file another tab queued since the ask, which only the index on disk knows of, is not queued twice.
      store.change((entries) => [
        ...entries,
        ...fresh.filter(
          ({ accountId, mediaId }) =>
            !entries.some((held) => held.accountId === accountId && held.mediaId === mediaId),
        ),
      ])
      tell()
      // The first download asks the browser to keep the origin's storage; a refusal changes nothing.
      if (isFirst) disk.persist().catch(() => undefined)
      pump()
      return { ok: true, value: list() }
    },
    decline: asks.decline,
    pause,
    resume,
    remove: async (downloadId) => {
      const entry = store.entryOf(downloadId)
      if (entry !== null) await drop([entry])
    },
    pauseAll: () => {
      store
        .own()
        .filter(({ status }) => isUnderWay(status))
        .forEach(({ downloadId }) => pause(downloadId))
    },
    resumeAll: () => {
      store
        .own()
        .filter(({ status }) => status.kind === DOWNLOAD_STATUS_KINDS.paused)
        .forEach(({ downloadId }) => requeue(downloadId))
      pump()
    },
    removeAll: () => drop(store.own()),
    reconnected: () => {
      const waiting = store
        .own()
        .filter(
          ({ downloadId, status }) =>
            stalled.has(downloadId) && status.kind === DOWNLOAD_STATUS_KINDS.paused,
        )
      waiting.forEach(({ downloadId }) => requeue(downloadId))
      fillPictures().catch(() => undefined)
      pump()
    },
    space: async () => {
      const { usage, quota } = await disk.space()
      return {
        free: Math.max(quota - usage, 0),
        total: quota,
        used: shown().reduce((sum, entry) => sum + bytesOf(entry), 0),
      }
    },
    pictureUrl: pictures.urlOf,
    playable: (downloadId) => {
      const entry = store.entryOf(downloadId)
      if (entry === null) return { ok: false, message: BROWSER_DOWNLOAD_COPY.unknown }
      if (entry.status.kind !== DOWNLOAD_STATUS_KINDS.ready) {
        return { ok: false, message: BROWSER_DOWNLOAD_COPY.notReady }
      }
      const logoUrl = entry.pictures.logo === null ? null : pictures.urlOf(entry.pictures.logo.id)
      return {
        ok: true,
        value: {
          downloadId,
          label: entry.label,
          title: entry.group.title,
          logo: logoUrl === null ? null : { url: logoUrl, name: entry.group.title },
          media: isMediaItem(entry.media) ? entry.media : null,
          resumeAt: entry.position,
          subtitles: entry.subtitles.map(({ track }) => track),
        },
      }
    },
    open: async (downloadId) => {
      const entry = store.entryOf(downloadId)
      if (entry === null) return null
      const file = await disk.read(mediaPathOf(entry)).catch(() => null)
      return file === null ? null : urls.create(file)
    },
    close: (url) => urls.revoke(url),
    cues: subtitles.cues,
    readyFor: (mediaId) =>
      store
        .own()
        .find(
          (entry) => entry.mediaId === mediaId && entry.status.kind === DOWNLOAD_STATUS_KINDS.ready,
        )?.downloadId ?? null,
    savePosition: ({ downloadId, position, duration }) => {
      const entry = store.entryOf(downloadId)
      if (entry === null) return
      store.patch({ downloadId, patch: { position, duration: duration ?? entry.duration } })
    },
  }
}
