import { advance } from '@/main/downloads/downloadState'
import type { DownloadsStore } from '@/main/downloads/downloadStore'

/**
 * What a run's part holds, counted as it is written, and whether its space check has passed:
 * from then on, what it still lacks is room another file may not take.
 */
export type RunDisk = { size: number; bytes: number; hasRoom: boolean }

/**
 * A file being fetched: `stop` aborts it, and `done` settles once it has let go of its files.
 * `hasAccess` is set once it has read its account ticket, so an end of the sign-in it was read
 * for ends it.
 */
type Run = {
  stop: AbortController
  done: Promise<void>
  disk: RunDisk
  hasAccess: boolean
}

type RunPickProps = { downloadId: string; run: Run }

/** Which runs an action picks. */
export type RunPick = (input: RunPickProps) => boolean

export const EVERY_RUN: RunPick = () => true

/** Picks the one run of `downloadId`. */
export const runOf =
  (downloadId: string): RunPick =>
  (candidate) =>
    candidate.downloadId === downloadId

// An AbortError, so `fetchToFile` reads a stopped fetch as aborted rather than unreachable.
const stopping = (): DOMException => new DOMException('The download was stopped', 'AbortError')

export type QueueRuns = {
  /** Starts tracking a run; it is dropped once `work` settles. */
  track: (input: TrackProps) => Run
  drop: (downloadId: string) => void
  isRunning: (downloadId: string) => boolean
  count: () => number
  /** The ids of the runs `isPicked` picks. */
  idsOf: (isPicked: RunPick) => string[]
  /** Aborts the picked runs and settles once each has let go of its files. */
  stop: (isPicked: RunPick) => Promise<void>
  /**
   * Writes what each picked run's part holds while its file is still downloading, before a
   * pause or a stop: progress is otherwise saved only every `PROGRESS_STEP_BYTES`.
   */
  saveBytes: (isPicked: RunPick) => void
  /** The room the runs past their space check still lack, which no other file may count on. */
  claimed: () => number
  /** Aborts every run, waiting for none. */
  abortAll: () => void
}

type TrackProps = { downloadId: string; disk: RunDisk; done: Promise<void> }

const lackedBy = ({ disk }: Run): number => (disk.hasRoom ? Math.max(disk.size - disk.bytes, 0) : 0)

/** The files the queue fetches now, by download id. */
export const createQueueRuns = (store: DownloadsStore): QueueRuns => {
  const running = new Map<string, Run>()

  const picked = (isPicked: RunPick): [string, Run][] =>
    [...running].filter(([downloadId, run]) => isPicked({ downloadId, run }))

  return {
    track: ({ downloadId, disk, done }) => {
      const run: Run = { stop: new AbortController(), done, disk, hasAccess: false }
      running.set(downloadId, run)
      return run
    },
    drop: (downloadId) => {
      running.delete(downloadId)
    },
    isRunning: (downloadId) => running.has(downloadId),
    count: () => running.size,
    idsOf: (isPicked) => picked(isPicked).map(([downloadId]) => downloadId),
    stop: async (isPicked) => {
      const stopped = picked(isPicked)
      stopped.forEach(([, run]) => run.stop.abort(stopping()))
      await Promise.all(stopped.map(([, run]) => run.done))
    },
    saveBytes: (isPicked) => {
      const saved = picked(isPicked)
      store.update((state) =>
        saved.reduce(
          (next, [downloadId, run]) => advance({ state: next, downloadId, bytes: run.disk.bytes }),
          state,
        ),
      )
    },
    claimed: () => [...running.values()].reduce((sum, run) => sum + lackedBy(run), 0),
    abortAll: () => {
      running.forEach((run) => run.stop.abort(stopping()))
    },
  }
}
