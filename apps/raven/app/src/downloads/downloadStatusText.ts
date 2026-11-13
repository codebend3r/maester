import type { DownloadReading } from '@raven/native/headless'

import { DOWNLOAD_COPY } from '@/downloads/copy'
import { DOWNLOAD_STATES, type UnderwayStatus } from '@/downloads/downloadEntries'

type PercentOfProps = { done: number; total: number }

const percentOf = ({ done, total }: PercentOfProps): number =>
  total > 0 ? Math.min(100, Math.floor((done / total) * 100)) : 0

type QueuedStatus = Extract<UnderwayStatus, { state: typeof DOWNLOAD_STATES.queued }>

/**
 * A queued download's words: "Queued" alone, or with how far the server has come with its copy
 * meanwhile, "Preparing on server 42%" or "Ready on server" once it is made.
 */
const queuedTextOf = (status: QueuedStatus): string => {
  const preparing = status.preparing ?? null
  if (preparing === null) return DOWNLOAD_COPY.queued
  const server =
    preparing >= 1
      ? DOWNLOAD_COPY.readyOnServer
      : DOWNLOAD_COPY.preparing(percentOf({ done: preparing, total: 1 }))
  return [DOWNLOAD_COPY.queued, server].join(DOWNLOAD_COPY.separator)
}

type UnderwayTextOfProps = { status: UnderwayStatus; reading: DownloadReading | undefined }

/** How far one download on its way has come: queued, the server's copy's percent, or its own. */
export const underwayTextOf = ({ status, reading }: UnderwayTextOfProps): string => {
  switch (status.state) {
    case DOWNLOAD_STATES.preparing:
      return DOWNLOAD_COPY.preparing(percentOf({ done: status.progress, total: 1 }))
    case DOWNLOAD_STATES.downloading:
      return DOWNLOAD_COPY.downloading(
        percentOf({ done: reading?.bytes ?? 0, total: reading?.total ?? 0 }),
      )
    case DOWNLOAD_STATES.queued:
      return queuedTextOf(status)
    default: {
      const unknown: never = status
      return unknown
    }
  }
}
