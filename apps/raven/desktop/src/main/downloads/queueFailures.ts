import { DOWNLOAD_STATUS_KINDS } from '@raven/core'
import { SERVER_NAME } from '@/main/desktopConfig'
import { DOWNLOAD_MESSAGES } from '@/main/downloads/downloadMessages'
import {
  entryById,
  fail,
  FAIL_REASONS,
  type DownloadEntry,
  type Failure,
  isUnderWay,
  PAUSE_REASONS,
  pause,
  pauseUnderWay,
  sameGroup,
  type PauseReason,
} from '@/main/downloads/downloadState'
import type { DownloadsStore } from '@/main/downloads/downloadStore'
import { FETCH_REASONS, type FetchOutcome } from '@/main/downloads/fetchFile'
import { ACCESS_REFUSALS, type AccessOutcome } from '@/main/downloads/mediaAccess'
import { EVERY_RUN, type QueueRuns, type RunPick } from '@/main/downloads/queueRuns'
import type { AccountRefusal } from '@/main/servers/authRefusals'
import { loggable } from '@/main/servers/serverCalls'
import { HTTP_STATUSES, isServerErrorStatus } from '@shared/http'

type FetchFailure = Extract<FetchOutcome, { ok: false }>
type AccessRefusal = Extract<AccessOutcome, { ok: false }>

/** An account refusal of a run, as the server said it or as the sign-in ending stands for. */
const accountFailure = (refusal: AccountRefusal): Failure => ({
  reason: FAIL_REASONS.account,
  refusal,
})

type CreateQueueFailuresProps = {
  store: DownloadsStore
  runs: QueueRuns
  /** The files the outage retry requeued, until they fail, finish or the viewer acts on them. */
  retried: Set<string>
  /** Lets go of the media origin picked, so the next file probes again. */
  forgetOrigin: () => void
  /** A file now waits on an outage, so the outage retry is armed. */
  onOutage: () => void
  onFailed: (entry: DownloadEntry) => void
  warn: (message: string) => void
}

export type QueueFailures = {
  failEntry: (input: FailEntryProps) => void
  /** Fails each of `downloadIds` for the account, its bytes kept, and stops the ones that run. */
  failRuns: (input: FailRunsProps) => void
  /** Tells the page of a file that failed, unless it failed again of an outage it was told of. */
  told: (downloadId: string) => void
  /** Fails or pauses the file for why its access could not be read. */
  settleAccess: (input: SettleAccessProps) => void
  /** Fails or pauses the file for why its fetch stopped short. */
  settleFetch: (input: SettleFetchProps) => void
  /** The disk is full: the file fails, and the files of its group still waiting wait paused. */
  failForSpace: (entry: DownloadEntry) => void
}

type FailEntryProps = { entry: DownloadEntry; failure: Failure }

type FailRunsProps = { downloadIds: readonly string[]; refusal: AccountRefusal }

type SettleAccessProps = { entry: DownloadEntry; refusal: AccessRefusal }

type SettleFetchProps = { entry: DownloadEntry; outcome: FetchFailure }

/**
 * What the queue does with a file that could not go on: a failure, or a pause of the files that
 * would meet the same end. Each change is made in the state before any run is stopped, so a
 * stopped run finds its entry as it should stay.
 */
export const createQueueFailures = ({
  store,
  runs,
  retried,
  forgetOrigin,
  onOutage,
  onFailed,
  warn,
}: CreateQueueFailuresProps): QueueFailures => {
  const told: QueueFailures['told'] = (downloadId) => {
    const entry = entryById({ state: store.read(), downloadId })
    const isRetried = retried.delete(downloadId)
    if (entry === null || entry.status.kind !== DOWNLOAD_STATUS_KINDS.failed) return
    // The outage was told when it began, and the row still says so.
    if (isRetried && entry.status.reason === FAIL_REASONS.unreachable) return
    onFailed(entry)
  }

  const failEntry: QueueFailures['failEntry'] = ({ entry, failure }) => {
    store.update((state) => fail({ state, downloadId: entry.downloadId, failure }))
    told(entry.downloadId)
  }

  /** The other files of the entry's group the queue still has to do. */
  const groupMatesOf = (entry: DownloadEntry): DownloadEntry[] =>
    store
      .read()
      .entries.filter(
        (other) =>
          other.downloadId !== entry.downloadId &&
          isUnderWay(other) &&
          sameGroup({ a: entry, b: other }),
      )

  const failForSpace: QueueFailures['failForSpace'] = (entry) => {
    const waiting = groupMatesOf(entry)
      .filter((other) => other.status.kind === DOWNLOAD_STATUS_KINDS.queued)
      .map(({ downloadId }) => downloadId)
    store.update((state) =>
      waiting.reduce(
        (next, downloadId) => pause({ state: next, downloadId, reason: PAUSE_REASONS.noSpace }),
        fail({
          state,
          downloadId: entry.downloadId,
          failure: { reason: FAIL_REASONS.noSpace },
        }),
      ),
    )
    runs.stop(({ downloadId }) => waiting.includes(downloadId)).catch(() => undefined)
    told(entry.downloadId)
  }

  type PauseOthersProps = { entry: DownloadEntry; reason: PauseReason }

  /** Every other waiting or running file waits paused for `reason`. */
  const pauseOthers = ({ entry, reason }: PauseOthersProps): void => {
    runs.saveBytes(EVERY_RUN)
    store.update((state) => pauseUnderWay({ state, reason }))
    runs.stop(({ downloadId }) => downloadId !== entry.downloadId).catch(() => undefined)
  }

  /** The server locked its library again: every file waits paused, running ones too. */
  const relock = (entry: DownloadEntry): void => {
    pauseOthers({ entry, reason: PAUSE_REASONS.relocked })
    warn(`${SERVER_NAME} locked ${loggable(entry.label)}'s library again`)
  }

  /**
   * The server could not be reached: this file fails, its part kept, and the rest wait paused,
   * so an outage costs one failure rather than the whole queue.
   */
  const failUnreachable = (entry: DownloadEntry): void => {
    failEntry({ entry, failure: { reason: FAIL_REASONS.unreachable } })
    pauseOthers({ entry, reason: PAUSE_REASONS.unreachable })
    onOutage()
    warn(`Raven could not reach ${SERVER_NAME} for ${loggable(entry.label)}`)
  }

  const failRuns: QueueFailures['failRuns'] = ({ downloadIds, refusal }) => {
    const isPicked: RunPick = ({ downloadId }) => downloadIds.includes(downloadId)
    runs.saveBytes(isPicked)
    store.update((state) =>
      downloadIds.reduce(
        (next, downloadId) => fail({ state: next, downloadId, failure: accountFailure(refusal) }),
        state,
      ),
    )
    runs.stop(isPicked).catch(() => undefined)
  }

  type FailAccountProps = { entry: DownloadEntry; refusal: AccountRefusal }

  /**
   * The server refused the account: this file fails with why, and so do the files of its group
   * still under way, which would meet the same refusal. Main reads the account again, so the page
   * hears it; the file told of is this one alone.
   */
  const failAccount = ({ entry, refusal }: FailAccountProps): void => {
    const group = groupMatesOf(entry).map(({ downloadId }) => downloadId)
    group.forEach((downloadId) => retried.delete(downloadId))
    failRuns({ downloadIds: [entry.downloadId, ...group], refusal })
    told(entry.downloadId)
    warn(`${SERVER_NAME} refused the account for ${loggable(entry.label)}`)
  }

  const settleAccess: QueueFailures['settleAccess'] = ({ entry, refusal }) => {
    switch (refusal.reason) {
      case ACCESS_REFUSALS.locked:
        relock(entry)
        return
      case ACCESS_REFUSALS.unreachable:
        failUnreachable(entry)
        return
      case ACCESS_REFUSALS.gone:
        failEntry({ entry, failure: { reason: FAIL_REASONS.gone } })
        return
      case ACCESS_REFUSALS.account:
        failAccount({ entry, refusal: refusal.refusal })
        return
      default: {
        const unreachable: never = refusal
        return unreachable
      }
    }
  }

  /** The origin picked may be the one that went away; the next file probes again. */
  const outage = (entry: DownloadEntry): void => {
    forgetOrigin()
    failUnreachable(entry)
  }

  type SettleStatusProps = { entry: DownloadEntry; status: number }

  /** What any other status means: a proxy in front of a restarting server answers 5xx, an outage. */
  const settleStatus = ({ entry, status }: SettleStatusProps): void => {
    if (isServerErrorStatus(status)) {
      outage(entry)
      return
    }
    if (status === HTTP_STATUSES.notFound) {
      failEntry({ entry, failure: { reason: FAIL_REASONS.gone } })
      return
    }
    failEntry({
      entry,
      failure: { reason: FAIL_REASONS.other, message: DOWNLOAD_MESSAGES.answered(status) },
    })
  }

  const settleFetch: QueueFailures['settleFetch'] = ({ entry, outcome }) => {
    switch (outcome.reason) {
      case FETCH_REASONS.locked:
        relock(entry)
        return
      case FETCH_REASONS.space:
        failForSpace(entry)
        return
      case FETCH_REASONS.changed:
        failEntry({ entry, failure: { reason: FAIL_REASONS.changed } })
        return
      case FETCH_REASONS.unreachable:
      case FETCH_REASONS.cut:
      case FETCH_REASONS.stalled:
      case FETCH_REASONS.aborted:
        outage(entry)
        return
      // A ticket refused again, or refused outright, is the account's refusal; accounts down are an outage.
      case FETCH_REASONS.unauthorized:
      case FETCH_REASONS.forbidden:
        if (outcome.refusal === null) {
          outage(entry)
          return
        }
        failAccount({ entry, refusal: outcome.refusal })
        return
      case FETCH_REASONS.status:
        settleStatus({ entry, status: outcome.status })
        return
      default: {
        const unreachable: never = outcome
        return unreachable
      }
    }
  }

  return { failEntry, failRuns, told, settleAccess, settleFetch, failForSpace }
}
