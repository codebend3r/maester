import { HTTP_STATUSES } from '@shared/http'
import { ApiError, LOCKED_STATUS } from '@raven/core'
import { BROWSER_DOWNLOAD_COPY } from '@/browserDownloads/copy'
import { DiskFullError } from '@/browserDownloads/disk'

/** How one run of a download ended. */
export const OUTCOMES = {
  ready: 'ready',
  failed: 'failed',
  paused: 'paused',
  stalled: 'stalled',
  aborted: 'aborted',
} as const

export type Outcome =
  | { kind: typeof OUTCOMES.ready }
  | { kind: typeof OUTCOMES.failed; message: string }
  | { kind: typeof OUTCOMES.paused; message: string }
  | { kind: typeof OUTCOMES.stalled }
  | { kind: typeof OUTCOMES.aborted }

export const READY = { kind: OUTCOMES.ready } as const satisfies Outcome
export const STALLED = { kind: OUTCOMES.stalled } as const satisfies Outcome
export const ABORTED = { kind: OUTCOMES.aborted } as const satisfies Outcome

/** The browser has no more room: the download waits for the viewer to make some. */
export const DISK_FULL = {
  kind: OUTCOMES.paused,
  message: BROWSER_DOWNLOAD_COPY.full,
} as const satisfies Outcome

/** Why the server would not send a file, as the row says it; null for an answer with bytes. */
export const refusalOf = (status: number): string | null => {
  if (status === HTTP_STATUSES.ok || status === HTTP_STATUSES.partialContent) return null
  if (status === HTTP_STATUSES.unauthorized || status === HTTP_STATUSES.forbidden)
    return BROWSER_DOWNLOAD_COPY.account
  if (status === HTTP_STATUSES.notFound) return BROWSER_DOWNLOAD_COPY.gone
  if (status === LOCKED_STATUS) return BROWSER_DOWNLOAD_COPY.locked
  return BROWSER_DOWNLOAD_COPY.answered(status)
}

/** Why a step threw: no room, a refusal the server worded, or no answer at all. */
export const outcomeOfError = (error: unknown): Outcome => {
  if (error instanceof DiskFullError) return DISK_FULL
  const isRefusal =
    error instanceof ApiError &&
    !error.isServerUnreachable &&
    error.status < HTTP_STATUSES.internalServerError
  return isRefusal ? { kind: OUTCOMES.failed, message: error.message } : STALLED
}
