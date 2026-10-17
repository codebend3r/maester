import { entryById, type DownloadEntry } from '@/main/downloads/downloadState'
import type { DownloadsStore } from '@/main/downloads/downloadStore'
import { errorText } from '@/main/log/errorText'
import { loggable } from '@/main/servers/serverCalls'
import { TIMER_MAX_MS, type Timers } from '@/main/stateStore'

/** A download set to delete once watched goes this long after it counts as watched. */
export const AUTO_DELETE_DELAY_MS = 600_000

export type AutoDeleteDeps = {
  store: DownloadsStore
  timers: Timers
  now: () => number
  /** Whether the player is on this download's video. */
  isPlaying: (downloadId: string) => boolean
  /** Whether the player would resume this download partway, short of where it counts as watched. */
  isMidTitle: (downloadId: string) => boolean
  /**
   * The download service's removal: it lets the server hear what was watched first, then
   * answers false without removing when the download is no longer due or the viewer is on it.
   */
  remove: (downloadId: string) => Promise<boolean>
  onDeleted: (entry: DownloadEntry) => void
  warn: (message: string) => void
}

export type AutoDelete = {
  /** At launch: a clock for every ready download set to delete once watched and watched. */
  rebuild: () => void
  /**
   * After a position is noted or the switch is turned on: a download with no clock gets one at
   * `watchedAt` plus the delay, and a deletion that waits on the viewer is tried again.
   */
  schedule: (input: { downloadId: string }) => void
  cancel: (input: { downloadId: string }) => void
  /** The player left a download: any deletion held while its file played is tried again. */
  playbackLeft: () => void
  /**
   * After a sleep: every running clock is armed again from its time. A timer stands still
   * while the Mac sleeps, so one left alone would delete late by the length of the sleep.
   */
  rearm: () => void
  /** When the clock deletes this download, while it runs; null once it waits on the viewer. */
  deletesAt: (input: { downloadId: string }) => number | null
  dispose: () => void
}

/**
 * Where a download stands with its deletion: its ten minutes running, held once they ran out
 * while the title played or was left partway, or being deleted.
 */
type Clock =
  | { kind: 'running'; at: number; timer: unknown }
  | { kind: 'held' }
  | { kind: 'deleting' }

/** How a removal the clock started went. */
type Removal = 'removed' | 'kept' | 'failed'

/** When a download counts as watched, for a ready one set to delete once watched; else null. */
const watchedAtOf = (entry: DownloadEntry | null): number | null =>
  entry !== null && entry.status.kind === 'ready' && entry.autoDelete ? entry.watchedAt : null

/** Whether a download's ten minutes have run out: ready, set to delete once watched, and watched. */
export const isDueForDeletion = ({
  entry,
  now,
}: {
  entry: DownloadEntry | null
  now: number
}): boolean => {
  const watchedAt = watchedAtOf(entry)
  return watchedAt !== null && watchedAt + AUTO_DELETE_DELAY_MS <= now
}

export const createAutoDelete = (deps: AutoDeleteDeps): AutoDelete => {
  const { store, timers } = deps
  const clocks = new Map<string, Clock>()
  let isDisposed = false

  const entryOf = (downloadId: string): DownloadEntry | null =>
    entryById(store.read(), { downloadId })

  const cancel: AutoDelete['cancel'] = ({ downloadId }) => {
    const clock = clocks.get(downloadId)
    if (clock?.kind === 'running') timers.clear(clock.timer)
    clocks.delete(downloadId)
  }

  const deleteNow = async (entry: DownloadEntry): Promise<void> => {
    const { downloadId } = entry
    const removal = await deps.remove(downloadId).then(
      (isRemoved): Removal => (isRemoved ? 'removed' : 'kept'),
      (error: unknown): Removal => {
        deps.warn(
          `raven player could not delete ${loggable(entry.label)} after watching: ${loggable(errorText(error))}`,
        )
        return 'failed'
      },
    )
    // A switch turned off or on while the removal waited has already replaced this clock.
    const isOwn = clocks.get(downloadId)?.kind === 'deleting'
    if (isOwn) clocks.delete(downloadId)
    switch (removal) {
      case 'removed':
        return deps.onDeleted(entry)
      case 'kept':
        // Read again as the download stands now: held while the viewer is on it.
        if (isOwn) armFromStore(downloadId)
        return
      case 'failed':
        // Tried again at the next launch, not in a loop of failures now.
        return
      default: {
        const unreachable: never = removal
        return unreachable
      }
    }
  }

  /** The time came: deletes the download, or holds it while the viewer is still on it. */
  const due = (downloadId: string): void => {
    if (isDisposed || clocks.get(downloadId)?.kind === 'deleting') return
    const entry = entryOf(downloadId)
    if (entry === null || watchedAtOf(entry) === null) return cancel({ downloadId })
    if (deps.isPlaying(downloadId) || deps.isMidTitle(downloadId)) {
      clocks.set(downloadId, { kind: 'held' })
      return
    }
    clocks.set(downloadId, { kind: 'deleting' })
    deleteNow(entry).catch((error: unknown) => {
      deps.warn(
        `raven player could not finish deleting ${loggable(entry.label)}: ${loggable(errorText(error))}`,
      )
    })
  }

  // A wait past what a timer holds (a clock put back since the title was watched) is cut to it,
  // and the timer then arms the rest, so the clock never runs out early.
  const arm = ({ downloadId, at }: { downloadId: string; at: number }): void => {
    if (isDisposed) return
    const wait = at - deps.now()
    if (wait <= 0) return due(downloadId)
    const timer = timers.set({
      run: () => arm({ downloadId, at }),
      ms: Math.min(wait, TIMER_MAX_MS),
    })
    clocks.set(downloadId, { kind: 'running', at, timer })
  }

  /** A clock at `watchedAt` plus the delay, read off the store now; none when not set to delete. */
  const armFromStore = (downloadId: string): void => {
    const watchedAt = watchedAtOf(entryOf(downloadId))
    if (watchedAt === null) return cancel({ downloadId })
    arm({ downloadId, at: watchedAt + AUTO_DELETE_DELAY_MS })
  }

  const rebuild: AutoDelete['rebuild'] = () => {
    store
      .read()
      .entries.filter((entry) => watchedAtOf(entry) !== null && !clocks.has(entry.downloadId))
      .forEach(({ downloadId }) => armFromStore(downloadId))
  }

  const schedule: AutoDelete['schedule'] = ({ downloadId }) => {
    const clock = clocks.get(downloadId)
    if (clock === undefined || watchedAtOf(entryOf(downloadId)) === null) {
      return armFromStore(downloadId)
    }
    if (clock.kind === 'held') due(downloadId)
  }

  const playbackLeft: AutoDelete['playbackLeft'] = () => {
    ;[...clocks]
      .filter(([, clock]) => clock.kind === 'held')
      .forEach(([downloadId]) => due(downloadId))
  }

  const rearm: AutoDelete['rearm'] = () => {
    ;[...clocks].forEach(([downloadId, clock]) => {
      if (clock.kind !== 'running') return
      timers.clear(clock.timer)
      arm({ downloadId, at: clock.at })
    })
  }

  const deletesAt: AutoDelete['deletesAt'] = ({ downloadId }) => {
    const clock = clocks.get(downloadId)
    return clock?.kind === 'running' ? clock.at : null
  }

  const dispose: AutoDelete['dispose'] = () => {
    isDisposed = true
    ;[...clocks.keys()].forEach((downloadId) => cancel({ downloadId }))
  }

  return { rebuild, schedule, cancel, playbackLeft, rearm, deletesAt, dispose }
}
