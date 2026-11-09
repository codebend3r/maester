import { DEVICE_DOWNLOAD_STATES, type DeviceDownload } from '@raven/core'

import {
  DOWNLOAD_STATES,
  DOWNLOAD_WAYS,
  type DownloadEntry,
  type EntryUpdate,
  isQueued,
} from '@/downloads/downloadEntries'
import type { DownloadDevice } from '@/downloads/downloadRun'

/** How often the queued copies behind the one downloading are asked for, so the server converts them ahead. */
const PREPARE_AHEAD_POLL_MS = 5000

/**
 * How many queued copies are asked for ahead of their turn: the server converts two at once,
 * and its cache evicts the least recently served copy to make room, so asking for more could
 * evict one waiting for its turn and have the server convert it twice.
 */
const PREPARE_AHEAD = 2

/** What asking ahead reads and writes: the queue as it stands, and each entry as it is now. */
export type AheadContext = {
  device: DownloadDevice
  /** The queue in its order: what is waiting, first place first. */
  queued: () => DownloadEntry[]
  /** The entry as it stands now, or null once it was let go of or queued again. */
  current: (entry: DownloadEntry) => DownloadEntry | null
  /** Writes `change` onto the entry, unless it was let go of or queued again meanwhile. */
  update: (props: EntryUpdate) => void
}

/** What a queued copy's status says of the server's answer: whole, part way, or nothing yet. */
const aheadProgressOf = (answer: DeviceDownload): number | null => {
  switch (answer.state) {
    case DEVICE_DOWNLOAD_STATES.ready:
      return 1
    case DEVICE_DOWNLOAD_STATES.preparing:
      return answer.progress
    case DEVICE_DOWNLOAD_STATES.failed:
      return null
    default: {
      const unknown: never = answer
      return unknown
    }
  }
}

type AskAheadProps = { entry: DownloadEntry; context: AheadContext }

/** Asks the server about one queued copy and writes its progress onto the queued status. */
const askAhead = async ({ entry, context }: AskAheadProps): Promise<void> => {
  const server = context.device.serverOf(entry.serverId)
  if (server === null) return
  const answer = await server.prepare(entry.mediaId).catch(() => null)
  const now = context.current(entry)
  if (answer === null || now === null || !isQueued(now)) return
  context.update({
    entry: now,
    change: { status: { state: DOWNLOAD_STATES.queued, preparing: aheadProgressOf(answer) } },
  })
}

/** One round of asking, then the next after the poll, until nothing is queued. */
const askAheadRound = async (context: AheadContext): Promise<void> => {
  const line = context.queued()
  if (line.length === 0) return
  const ahead = line.filter((entry) => entry.way === DOWNLOAD_WAYS.copy).slice(0, PREPARE_AHEAD)
  await Promise.all(ahead.map((entry) => askAhead({ entry, context })))
  await context.device.wait(PREPARE_AHEAD_POLL_MS)
  return askAheadRound(context)
}

/**
 * Asks the server for the first `PREPARE_AHEAD` queued copies every `PREPARE_AHEAD_POLL_MS`
 * while anything is queued, so their MP4s are made before their turn. Asking is not fetching:
 * the entries stay in the queue and move with it. Waits first, since the first copy in the
 * line is the running fetch's own to ask about. Resolves once the queue is empty.
 */
export const prepareAhead = async (context: AheadContext): Promise<void> => {
  await context.device.wait(PREPARE_AHEAD_POLL_MS)
  return askAheadRound(context)
}
