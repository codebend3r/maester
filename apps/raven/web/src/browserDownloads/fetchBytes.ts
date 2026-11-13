import { ABORT, type DownloadClock } from '@/browserDownloads/clock'
import { DiskFullError, type DownloadDisk } from '@/browserDownloads/disk'
import { type BrowserEntry, mediaPathOf } from '@/browserDownloads/entries'
import {
  ABORTED,
  DISK_FULL,
  OUTCOMES,
  type Outcome,
  READY,
  refusalOf,
  STALLED,
} from '@/browserDownloads/outcomes'
import type { BytesAnswer, DownloadServer } from '@/browserDownloads/server'
import { HEADERS, HTTP_STATUSES } from '@shared/http'

/*
 * A writable's bytes join the file only when it closes, and opening it again copies the file so
 * far, so a download commits each time it has doubled, and never less than this at once: a
 * closed tab loses at most half of what was fetched, and the copies add up to twice the file.
 */
const COMMIT_MIN_BYTES = 64 * 1024 ** 2

/** How long a response may send nothing, its first byte included, before it is given up: Raven's own wait. */
export const STALL_MS = 30_000

const CONTENT_RANGE = /^bytes (\d+)-\d+\/(\d+)$/u

type TotalOfProps = { answer: BytesAnswer; from: number }

/** The file's whole size as the answer names it, or null when it names none. */
const totalOf = ({ answer, from }: TotalOfProps): number | null => {
  const range = CONTENT_RANGE.exec(answer.headers.get(HEADERS.contentRange) ?? '')
  if (range !== null) return Number(range[2])
  const length = /^\d+$/u.exec(answer.headers.get(HEADERS.contentLength) ?? '')
  return length === null ? null : from + Number(length[0])
}

type StallWatchProps = { clock: DownloadClock; signal: AbortSignal }

/** A response under watch: `signal` aborts when the run stops or the response goes quiet. */
type StallWatch = {
  signal: AbortSignal
  /** Says the response answered or sent a chunk just now. */
  heard: () => void
  stop: () => void
}

/** Watches one response, and gives it up once it has sent nothing for `STALL_MS`. */
const stallWatch = ({ clock, signal }: StallWatchProps): StallWatch => {
  const quiet = new AbortController()
  const state = { heardAt: clock.now(), stop: () => {} }
  const check = (): void => {
    const silence = clock.now() - state.heardAt
    if (silence >= STALL_MS) return quiet.abort(new Error('The response sent nothing in time.'))
    state.stop = clock.after({ ms: STALL_MS - silence, run: check })
  }
  state.stop = clock.after({ ms: STALL_MS, run: check })
  return {
    signal: AbortSignal.any([signal, quiet.signal]),
    heard: () => {
      state.heardAt = clock.now()
    },
    stop: () => state.stop(),
  }
}

type FetchBytesProps = {
  disk: DownloadDisk
  server: DownloadServer
  clock: DownloadClock
  entry: BrowserEntry
  /** Stops the run: a pause, a delete, an account that left. */
  signal: AbortSignal
  isRetry: boolean
  /** Hears how many bytes of the file are in hand, as each chunk lands. */
  onProgress: (bytes: number) => void
  /** Hears the file's size when the answer names another than the entry holds. */
  onSize: (size: number) => void
}

const RETRY = 'retry'

/** What one response came to: how the download ended, or that it is worth one more ask. */
type Attempt = Outcome | { kind: typeof RETRY; size: number }

type AttemptProps = FetchBytesProps & { watch: StallWatch }

const attempt = async ({
  disk,
  server,
  entry,
  signal,
  isRetry,
  onProgress,
  onSize,
  watch,
}: AttemptProps): Promise<Attempt> => {
  const again = { kind: RETRY, size: entry.size } as const satisfies Attempt
  const path = mediaPathOf(entry)
  const onDisk = await disk.size(path)
  if (onDisk === entry.size && onDisk > 0) return READY
  const from = onDisk > entry.size ? 0 : onDisk
  const answer = await server.bytes({
    mediaId: entry.mediaId,
    way: entry.way,
    from,
    signal: watch.signal,
    isFresh: isRetry,
  })
  watch.heard()
  if (answer.status === HTTP_STATUSES.unauthorized && !isRetry) {
    await answer.body?.cancel().catch(() => undefined)
    return again
  }
  if (answer.status === HTTP_STATUSES.rangeNotSatisfiable && !isRetry) {
    await answer.body?.cancel().catch(() => undefined)
    await disk.remove(path)
    return again
  }
  const refusal = refusalOf(answer.status)
  if (refusal !== null) {
    await answer.body?.cancel().catch(() => undefined)
    return { kind: OUTCOMES.failed, message: refusal }
  }
  if (answer.body === null) return STALLED
  // A server that ignores the range sends the whole file, which starts the one on disk over.
  const start = answer.status === HTTP_STATUSES.partialContent ? from : 0
  const total = totalOf({ answer, from: start }) ?? entry.size
  if (total !== entry.size) onSize(total)
  const writer = await disk.open({ path, from: start })
  const written = { bytes: start, committed: start }
  /** A cut or a response gone quiet after new bytes is asked for once more, from where it stopped. */
  const cut = (): Attempt =>
    written.bytes > start && !isRetry ? { kind: RETRY, size: total } : STALLED
  onProgress(start)
  try {
    await answer.body.pipeTo(
      new WritableStream<Uint8Array>({
        // A stopped run or a quiet response errors the sink, which ends the pipe and lets go of the response.
        start: (controller) =>
          watch.signal.addEventListener(ABORT, () => controller.error(watch.signal.reason), {
            once: true,
          }),
        write: async (chunk) => {
          watch.heard()
          await writer.write(chunk)
          written.bytes += chunk.byteLength
          onProgress(written.bytes)
          const fresh = written.bytes - written.committed
          if (fresh < Math.max(COMMIT_MIN_BYTES, written.committed)) return
          await writer.commit()
          written.committed = written.bytes
        },
      }),
    )
  } catch (error) {
    // Closing keeps what was written, so a pause or a cut resumes from it.
    await writer.close().catch(() => undefined)
    if (signal.aborted) return ABORTED
    return error instanceof DiskFullError ? DISK_FULL : cut()
  }
  await writer.close()
  return written.bytes >= total ? READY : cut()
}

/**
 * The file's bytes, from the last one on disk on, written as they come. A `401` is asked again
 * once with a new ticket, a range the server says no longer fits starts the file over once, and
 * a response that is cut, or sends nothing for `STALL_MS`, after new bytes resumes once.
 */
export const fetchBytes = async (props: FetchBytesProps): Promise<Outcome> => {
  const { clock, entry, signal } = props
  if (signal.aborted) return ABORTED
  const watch = stallWatch({ clock, signal })
  const result = await attempt({ ...props, watch }).finally(watch.stop)
  if (result.kind !== RETRY) return result
  return fetchBytes({ ...props, entry: { ...entry, size: result.size }, isRetry: true })
}
