import { LOCKED_STATUS } from '@raven/core'
import type { Timers } from '@/main/stateStore'

export const PROGRESS_STEP_BYTES = 8 * 1024 ** 2
export const PROGRESS_STEP_MS = 1000
export const DOWNLOAD_STALL_MS = 30_000

export type StreamFetch = (input: {
  url: string
  headers: Record<string, string>
  signal: AbortSignal
}) => Promise<{
  status: number
  headers: { get: (name: string) => string | null }
  body: ReadableStream<Uint8Array> | null
}>

export type PartFile = {
  size: () => Promise<number>
  append: (chunk: Uint8Array) => Promise<void>
  truncate: () => Promise<void>
  close: () => Promise<void>
}

export type FetchOutcome =
  | { ok: true; bytes: number }
  | {
      ok: false
      reason:
        | 'aborted'
        | 'unreachable'
        | 'stalled'
        | 'changed'
        | 'locked'
        | 'unauthorized'
        | 'space'
        | 'status'
      status: number | null
      bytes: number
    }

const UNSATISFIABLE_RANGE_STATUS = 416

type FailureReason = Extract<FetchOutcome, { ok: false }>['reason']

type FetchInput = {
  fetch: StreamFetch
  url: string
  part: PartFile
  expectedSize: number
  signal: AbortSignal
  timers: Timers
  now: () => number
  stallMs?: number
  onProgress: (bytes: number) => void
}

type Answer = Awaited<ReturnType<StreamFetch>>

/** Why the sink stopped the pipe, so the outcome is not guessed from the error that comes out of it. */
type Stop = { kind: 'overflow' } | { kind: 'space' } | { kind: 'write'; error: unknown }

type Plan = 'append' | 'restart' | 'changed' | 'unexpected'

const failure = ({
  reason,
  status = null,
  bytes,
}: {
  reason: FailureReason
  status?: number | null
  bytes: number
}): FetchOutcome => ({ ok: false, reason, status, bytes })

const isAbortError = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError'

const isNoSpace = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOSPC'

/** The first byte of a `Content-Range` such as `bytes 1024-2047/4096`; `null` when absent or malformed. */
export const contentRangeStart = (header: string | null): number | null => {
  const match = /^bytes (\d+)-\d+\/(?:\d+|\*)$/u.exec(header ?? '')
  const start = match?.[1]
  return start === undefined ? null : Number(start)
}

const refusalFor = (status: number): { reason: FailureReason; status: number } | null => {
  if (status >= 200 && status < 300) return null
  switch (status) {
    case 401:
      return { reason: 'unauthorized', status }
    case LOCKED_STATUS:
      return { reason: 'locked', status }
    case UNSATISFIABLE_RANGE_STATUS:
      return { reason: 'changed', status }
    default:
      return { reason: 'status', status }
  }
}

const planFor = ({
  status,
  from,
  rangeStart,
}: {
  status: number
  from: number
  rangeStart: number | null
}): Plan => {
  if (status !== 200 && status !== 206) return 'unexpected'
  if (from === 0) return status === 200 ? 'append' : 'changed'
  return status === 206 && rangeStart === from ? 'append' : 'restart'
}

const discard = async (body: Answer['body']): Promise<void> => {
  await body?.cancel().catch(() => undefined)
}

const streamToPart = async ({
  body,
  from,
  part,
  expectedSize,
  signal,
  timers,
  now,
  stallMs,
  onProgress,
}: Omit<FetchInput, 'fetch' | 'url'> & {
  body: Answer['body']
  from: number
  stallMs: number
}): Promise<FetchOutcome> => {
  const progress = { bytes: from, reportedBytes: from, reportedAt: now() }
  const stop: { value: Stop | null } = { value: null }
  const stall: { isStalled: boolean; handle: unknown } = { isStalled: false, handle: null }
  const internal = new AbortController()

  const arm = () => {
    timers.clear(stall.handle)
    stall.handle = timers.set(() => {
      stall.isStalled = true
      internal.abort()
    }, stallMs)
  }

  const sink = new WritableStream<Uint8Array>({
    write: async (chunk) => {
      timers.clear(stall.handle)
      const total = progress.bytes + chunk.length
      if (total > expectedSize) {
        stop.value = { kind: 'overflow' }
        throw new Error('The body is longer than the file')
      }
      try {
        await part.append(chunk)
      } catch (error) {
        stop.value = isNoSpace(error) ? { kind: 'space' } : { kind: 'write', error }
        throw new Error('The chunk could not be written', { cause: error })
      }
      progress.bytes = total
      const at = now()
      if (
        total - progress.reportedBytes >= PROGRESS_STEP_BYTES &&
        at - progress.reportedAt >= PROGRESS_STEP_MS
      ) {
        onProgress(total)
        progress.reportedBytes = total
        progress.reportedAt = at
      }
      arm()
    },
  })

  arm()
  const piped = await (body ?? new ReadableStream<Uint8Array>({ start: (c) => c.close() }))
    .pipeTo(sink, { signal: AbortSignal.any([signal, internal.signal]) })
    .then(
      () => ({ isFailed: false as const }),
      () => ({ isFailed: true as const }),
    )
  timers.clear(stall.handle)

  const end = stop.value
  if (end?.kind === 'overflow') {
    await part.truncate()
    return failure({ reason: 'changed', bytes: 0 })
  }
  if (end?.kind === 'space') return failure({ reason: 'space', bytes: progress.bytes })
  if (end?.kind === 'write') throw end.error
  if (piped.isFailed) {
    const reason = signal.aborted ? 'aborted' : stall.isStalled ? 'stalled' : 'unreachable'
    return failure({ reason, bytes: progress.bytes })
  }
  if (progress.bytes !== expectedSize) {
    await part.truncate()
    return failure({ reason: 'changed', bytes: 0 })
  }
  onProgress(progress.bytes)
  return { ok: true, bytes: progress.bytes }
}

const download = async ({
  canRestart,
  ...input
}: FetchInput & { canRestart: boolean }): Promise<FetchOutcome> => {
  const { fetch, url, part, signal, timers, stallMs, expectedSize, onProgress } = input
  const from = await part.size()
  if (from === expectedSize) {
    onProgress(from)
    return { ok: true, bytes: from }
  }
  if (from > expectedSize) {
    await part.truncate()
    if (!canRestart) return failure({ reason: 'changed', bytes: 0 })
    return download({ ...input, canRestart: false })
  }
  // A server that takes the request and never answers it stalls the file as a silent body does.
  const late = new AbortController()
  const wait: { isStalled: boolean } = { isStalled: false }
  const timer = timers.set(() => {
    wait.isStalled = true
    late.abort()
  }, stallMs ?? DOWNLOAD_STALL_MS)
  const answer = await fetch({
    url,
    headers: from > 0 ? { Range: `bytes=${from}-` } : {},
    signal: AbortSignal.any([signal, late.signal]),
  })
    .then(
      (response) => ({ isFailed: false as const, response }),
      (error: unknown) => ({ isFailed: true as const, error }),
    )
    .finally(() => timers.clear(timer))
  if (answer.isFailed) {
    const isAborted = signal.aborted && isAbortError(answer.error)
    const reason = isAborted ? 'aborted' : wait.isStalled ? 'stalled' : 'unreachable'
    return failure({ reason, bytes: from })
  }
  const { response } = answer
  const refusal = refusalFor(response.status)
  if (refusal !== null) {
    await discard(response.body)
    if (refusal.status === UNSATISFIABLE_RANGE_STATUS) {
      // The server's file is now shorter than the bytes on disk; keeping them would earn the same 416 on every retry.
      await part.truncate()
      return failure({ ...refusal, bytes: 0 })
    }
    return failure({ ...refusal, bytes: from })
  }
  const plan = planFor({
    status: response.status,
    from,
    rangeStart: contentRangeStart(response.headers.get('content-range')),
  })
  switch (plan) {
    case 'append':
      return streamToPart({
        ...input,
        body: response.body,
        from,
        stallMs: stallMs ?? DOWNLOAD_STALL_MS,
      })
    case 'restart':
      await discard(response.body)
      await part.truncate()
      if (!canRestart) return failure({ reason: 'changed', bytes: 0 })
      return download({ ...input, canRestart: false })
    case 'changed':
      await discard(response.body)
      return failure({ reason: 'changed', bytes: from })
    case 'unexpected':
      await discard(response.body)
      return failure({ reason: 'status', status: response.status, bytes: from })
    default: {
      const unreachable: never = plan
      throw new Error(`Unknown plan ${String(unreachable)}`)
    }
  }
}

/**
 * Fetches one file into its `.part`, resuming from the bytes already on disk. It answers an
 * outcome and never logs; the caller decides what each one means.
 */
export const fetchToFile = async (input: FetchInput): Promise<FetchOutcome> => {
  try {
    return await download({ ...input, canRestart: true })
  } finally {
    // A file that will not close changes nothing the outcome says: the next resume reads the size from disk.
    await input.part.close().catch(() => undefined)
  }
}
