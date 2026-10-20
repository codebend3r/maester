import { AUTH_REFUSALS, LOCKED_STATUS } from '@raven/core'
import type { AccountRefusal } from '@/main/downloads/downloadMessages'
import { ACCOUNT_REFUSAL_STATUSES, readShort, refusalAt } from '@/main/servers/authRefusals'
import type { Timers } from '@/main/stateStore'
import { HTTP_HEADERS } from '@/shared/httpHeaders'
import { HTTP_STATUSES } from '@/shared/httpStatuses'

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

export const FETCH_REASONS = {
  aborted: 'aborted',
  unreachable: 'unreachable',
  /** The response began and ended short: its body broke, or ended before the bytes it promised. */
  cut: 'cut',
  stalled: 'stalled',
  changed: 'changed',
  locked: 'locked',
  unauthorized: 'unauthorized',
  space: 'space',
  status: 'status',
} as const

/** `refusal` is why a `401` or `403` body says it refused the account, or null. */
export type FetchOutcome =
  | { ok: true; bytes: number }
  | {
      ok: false
      reason: (typeof FETCH_REASONS)[keyof typeof FETCH_REASONS]
      status: number | null
      refusal: AccountRefusal | null
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
const STOP_KINDS = { overflow: 'overflow', space: 'space', write: 'write' } as const

type Stop =
  | { kind: typeof STOP_KINDS.overflow }
  | { kind: typeof STOP_KINDS.space }
  | { kind: typeof STOP_KINDS.write; error: unknown }

const PLANS = {
  append: 'append',
  restart: 'restart',
  changed: 'changed',
  unexpected: 'unexpected',
} as const

type Plan = (typeof PLANS)[keyof typeof PLANS]

const failure = ({
  reason,
  status = null,
  refusal = null,
  bytes,
}: {
  reason: FailureReason
  status?: number | null
  refusal?: AccountRefusal | null
  bytes: number
}): FetchOutcome => ({ ok: false, reason, status, refusal, bytes })

const isAbortError = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError'

const isNoSpace = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOSPC'

const CONTENT_RANGE = /^bytes (\d+)-(\d+)\/(?:\d+|\*)$/u

/** The first byte of a `Content-Range` such as `bytes 1024-2047/4096`; `null` when absent or malformed. */
export const contentRangeStart = (header: string | null): number | null => {
  const start = CONTENT_RANGE.exec(header ?? '')?.[1] ?? null
  return start === null ? null : Number(start)
}

/**
 * The size the part reaches once the body sends all the response promised: the bytes on disk and
 * its `Content-Length`, else past the last byte of its `Content-Range`; `null` when it promised neither.
 */
const promisedSize = ({
  from,
  headers,
}: {
  from: number
  headers: Answer['headers']
}): number | null => {
  const length = /^\d+$/u.exec(headers.get(HTTP_HEADERS.contentLength) ?? '')?.[0] ?? null
  if (length !== null) return from + Number(length)
  const last = CONTENT_RANGE.exec(headers.get(HTTP_HEADERS.contentRange) ?? '')?.[2] ?? null
  return last === null ? null : Number(last) + 1
}

const refusalFor = (status: number): { reason: FailureReason; status: number } | null => {
  if (status >= 200 && status < 300) return null
  switch (status) {
    case HTTP_STATUSES.unauthorized:
      return { reason: FETCH_REASONS.unauthorized, status }
    case LOCKED_STATUS:
      return { reason: FETCH_REASONS.locked, status }
    case UNSATISFIABLE_RANGE_STATUS:
      return { reason: FETCH_REASONS.changed, status }
    default:
      return { reason: FETCH_REASONS.status, status }
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
  if (status !== HTTP_STATUSES.ok && status !== HTTP_STATUSES.partialContent)
    return PLANS.unexpected
  if (from === 0) return status === HTTP_STATUSES.ok ? PLANS.append : PLANS.changed
  return status === HTTP_STATUSES.partialContent && rangeStart === from
    ? PLANS.append
    : PLANS.restart
}

const discard = async (body: Answer['body']): Promise<void> => {
  await body?.cancel().catch(() => undefined)
}

/** The account refusal a `401` or `403` body names; any other refused body is only let go of. */
const refusalIn = async ({
  status,
  body,
}: {
  status: number
  body: Answer['body']
}): Promise<AccountRefusal | null> => {
  if (status !== HTTP_STATUSES.unauthorized && status !== HTTP_STATUSES.forbidden) {
    await discard(body)
    return null
  }
  const reason = refusalAt({
    status,
    body: await readShort(body),
    statuses: ACCOUNT_REFUSAL_STATUSES,
  })
  // Accounts that are down are the server's outage, not a refusal of this account.
  return reason === AUTH_REFUSALS.unavailable ? null : reason
}

const streamToPart = async ({
  body,
  from,
  promised,
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
  promised: number | null
  stallMs: number
}): Promise<FetchOutcome> => {
  const progress = { bytes: from, reportedBytes: from, reportedAt: now() }
  const stop: { value: Stop | null } = { value: null }
  const stall: { isStalled: boolean; handle: unknown } = { isStalled: false, handle: null }
  const internal = new AbortController()

  const arm = () => {
    timers.clear(stall.handle)
    stall.handle = timers.set({
      run: () => {
        stall.isStalled = true
        internal.abort()
      },
      ms: stallMs,
    })
  }

  const sink = new WritableStream<Uint8Array>({
    write: async (chunk) => {
      timers.clear(stall.handle)
      const total = progress.bytes + chunk.length
      if (total > expectedSize) {
        stop.value = { kind: STOP_KINDS.overflow }
        throw new Error('The body is longer than the file')
      }
      try {
        await part.append(chunk)
      } catch (error) {
        stop.value = isNoSpace(error)
          ? { kind: STOP_KINDS.space }
          : { kind: STOP_KINDS.write, error }
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
  if (end?.kind === STOP_KINDS.overflow) {
    await part.truncate()
    return failure({ reason: FETCH_REASONS.changed, bytes: 0 })
  }
  if (end?.kind === STOP_KINDS.space)
    return failure({ reason: FETCH_REASONS.space, bytes: progress.bytes })
  if (end?.kind === STOP_KINDS.write) throw end.error
  if (piped.isFailed) {
    const reason = signal.aborted
      ? FETCH_REASONS.aborted
      : stall.isStalled
        ? FETCH_REASONS.stalled
        : FETCH_REASONS.cut
    return failure({ reason, bytes: progress.bytes })
  }
  if (progress.bytes !== expectedSize) {
    // A body that ends before the bytes it promised was cut, not a shorter file: what came is kept.
    if (promised !== null && progress.bytes < promised)
      return failure({ reason: FETCH_REASONS.cut, bytes: progress.bytes })
    await part.truncate()
    return failure({ reason: FETCH_REASONS.changed, bytes: 0 })
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
    if (!canRestart) return failure({ reason: FETCH_REASONS.changed, bytes: 0 })
    return download({ ...input, canRestart: false })
  }
  // A server that takes the request and never answers it stalls the file as a silent body does.
  const late = new AbortController()
  const wait: { isStalled: boolean } = { isStalled: false }
  const timer = timers.set({
    run: () => {
      wait.isStalled = true
      late.abort()
    },
    ms: stallMs ?? DOWNLOAD_STALL_MS,
  })
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
    const reason = isAborted
      ? FETCH_REASONS.aborted
      : wait.isStalled
        ? FETCH_REASONS.stalled
        : FETCH_REASONS.unreachable
    return failure({ reason, bytes: from })
  }
  const { response } = answer
  const refusal = refusalFor(response.status)
  if (refusal !== null) {
    const reason = await refusalIn({ status: response.status, body: response.body })
    if (refusal.status === UNSATISFIABLE_RANGE_STATUS) {
      // The server's file is now shorter than the bytes on disk; keeping them would earn the same 416 on every retry.
      await part.truncate()
      return failure({ ...refusal, bytes: 0 })
    }
    return failure({ ...refusal, refusal: reason, bytes: from })
  }
  const plan = planFor({
    status: response.status,
    from,
    rangeStart: contentRangeStart(response.headers.get(HTTP_HEADERS.contentRange)),
  })
  switch (plan) {
    case PLANS.append:
      return streamToPart({
        ...input,
        body: response.body,
        from,
        promised: promisedSize({ from, headers: response.headers }),
        stallMs: stallMs ?? DOWNLOAD_STALL_MS,
      })
    case PLANS.restart:
      await discard(response.body)
      await part.truncate()
      if (!canRestart) return failure({ reason: FETCH_REASONS.changed, bytes: 0 })
      return download({ ...input, canRestart: false })
    case PLANS.changed:
      await discard(response.body)
      return failure({ reason: FETCH_REASONS.changed, bytes: from })
    case PLANS.unexpected:
      await discard(response.body)
      return failure({ reason: FETCH_REASONS.status, status: response.status, bytes: from })
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
