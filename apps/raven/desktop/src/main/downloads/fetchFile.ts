import { LOCKED_STATUS } from '@raven/core'
import { accountRefusalOf, type AccountRefusal, readShort } from '@/main/servers/authRefusals'
import { ERROR_CODES, errorCodeOf } from '@/main/stateStore'
import type { Timers } from '@/main/timers'
import { HEADERS, HTTP_STATUSES, isSuccessStatus } from '@shared/http'

export const PROGRESS_STEP_BYTES = 8 * 1024 ** 2
export const PROGRESS_STEP_MS = 1000
export const DOWNLOAD_STALL_MS = 30_000

type StreamFetchProps = {
  url: string
  headers: Record<string, string>
  signal: AbortSignal
}

export type StreamFetch = (input: StreamFetchProps) => Promise<{
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
  /** A `401`: the ticket was refused. */
  unauthorized: 'unauthorized',
  /** A `403`: the account was refused. */
  forbidden: 'forbidden',
  space: 'space',
  /** Any other status the fetch cannot use. */
  status: 'status',
} as const

type FetchReason = (typeof FETCH_REASONS)[keyof typeof FETCH_REASONS]

type RefusedReason = typeof FETCH_REASONS.unauthorized | typeof FETCH_REASONS.forbidden

type PlainReason = Exclude<FetchReason, RefusedReason | typeof FETCH_REASONS.status>

/**
 * How a fetch ended, and the bytes its part holds then. A `401` or `403` carries why its body
 * says the account was refused, or the refusal its status stands for; null when the server's
 * accounts are down, which is an outage. Any other unusable status carries the status.
 */
export type FetchOutcome =
  | { ok: true; bytes: number }
  | { ok: false; reason: PlainReason; bytes: number }
  | { ok: false; reason: RefusedReason; refusal: AccountRefusal | null; bytes: number }
  | { ok: false; reason: typeof FETCH_REASONS.status; status: number; bytes: number }

type Failure = Extract<FetchOutcome, { ok: false }>

type CutReasonOfProps = { isAborted: boolean; isStalled: boolean; fallback: PlainReason }

/** Why a fetch that failed stopped: aborted, else stalled, else `fallback`. */
const cutReasonOf = ({ isAborted, isStalled, fallback }: CutReasonOfProps): PlainReason => {
  if (isAborted) return FETCH_REASONS.aborted
  return isStalled ? FETCH_REASONS.stalled : fallback
}

type PlainFailureProps = { reason: PlainReason; bytes: number }

const failure = ({ reason, bytes }: PlainFailureProps): Failure => ({ ok: false, reason, bytes })

type FetchInput = {
  fetch: StreamFetch
  url: string
  part: PartFile
  expectedSize: number
  signal: AbortSignal
  timers: Timers
  now: () => number
  stallMs: number
  onProgress: (bytes: number) => void
}

export type FetchToFileProps = Omit<FetchInput, 'stallMs'> & {
  /** `DOWNLOAD_STALL_MS` unless a test needs it short. */
  stallMs?: number
}

type StreamToPartProps = Omit<FetchInput, 'fetch' | 'url'> & {
  body: Answer['body']
  from: number
  promised: number | null
}

type DownloadProps = FetchInput & { canRestart: boolean }

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

const isAbortError = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError'

const isNoSpace = (error: unknown): boolean => errorCodeOf(error) === ERROR_CODES.noSpace

const CONTENT_RANGE = /^bytes (\d+)-(\d+)\/(?:\d+|\*)$/u

/** The first byte of a `Content-Range` such as `bytes 1024-2047/4096`; `null` when absent or malformed. */
export const contentRangeStart = (header: string | null): number | null => {
  const start = CONTENT_RANGE.exec(header ?? '')?.[1] ?? null
  return start === null ? null : Number(start)
}

type PromisedSizeProps = {
  from: number
  headers: Answer['headers']
}

/**
 * The size the part reaches once the body sends all the response promised: the bytes on disk and
 * its `Content-Length`, else past the last byte of its `Content-Range`; `null` when it promised neither.
 */
const promisedSize = ({ from, headers }: PromisedSizeProps): number | null => {
  const length = /^\d+$/u.exec(headers.get(HEADERS.contentLength) ?? '')?.[0] ?? null
  if (length !== null) return from + Number(length)
  const last = CONTENT_RANGE.exec(headers.get(HEADERS.contentRange) ?? '')?.[2] ?? null
  return last === null ? null : Number(last) + 1
}

type PlanForProps = {
  status: number
  from: number
  rangeStart: number | null
}

const planFor = ({ status, from, rangeStart }: PlanForProps): Plan => {
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

/** The statuses a fetch is refused with, by the reason each stands for. */
const REFUSED_REASONS: ReadonlyMap<number, RefusedReason> = new Map([
  [HTTP_STATUSES.unauthorized, FETCH_REASONS.unauthorized],
  [HTTP_STATUSES.forbidden, FETCH_REASONS.forbidden],
])

type RefusedOfProps = { status: number; body: Answer['body']; from: number }

/**
 * How an answer that is not a success ends the fetch, its body read for an account refusal or let
 * go of. Null for a success, which the fetch reads on.
 */
const refusedOf = async ({ status, body, from }: RefusedOfProps): Promise<Failure | null> => {
  if (isSuccessStatus(status)) return null
  const refused = REFUSED_REASONS.get(status)
  if (refused !== undefined) {
    const refusal = accountRefusalOf({ status, body: await readShort(body) })
    return { ok: false, reason: refused, refusal, bytes: from }
  }
  await discard(body)
  if (status === LOCKED_STATUS) return failure({ reason: FETCH_REASONS.locked, bytes: from })
  if (status === HTTP_STATUSES.rangeNotSatisfiable) {
    // The server's file is now shorter than the bytes on disk; keeping them would earn the same 416 on every retry.
    return failure({ reason: FETCH_REASONS.changed, bytes: 0 })
  }
  return { ok: false, reason: FETCH_REASONS.status, status, bytes: from }
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
}: StreamToPartProps): Promise<FetchOutcome> => {
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
    const reason = cutReasonOf({
      isAborted: signal.aborted,
      isStalled: stall.isStalled,
      fallback: FETCH_REASONS.cut,
    })
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

const download = async ({ canRestart, ...input }: DownloadProps): Promise<FetchOutcome> => {
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
    ms: stallMs,
  })
  const answer = await fetch({
    url,
    headers: from > 0 ? { [HEADERS.range]: `bytes=${from}-` } : {},
    signal: AbortSignal.any([signal, late.signal]),
  })
    .then(
      (response) => ({ isFailed: false as const, response }),
      (error: unknown) => ({ isFailed: true as const, error }),
    )
    .finally(() => timers.clear(timer))
  if (answer.isFailed) {
    const isAborted = signal.aborted && isAbortError(answer.error)
    const reason = cutReasonOf({
      isAborted,
      isStalled: wait.isStalled,
      fallback: FETCH_REASONS.unreachable,
    })
    return failure({ reason, bytes: from })
  }
  const { response } = answer
  const refused = await refusedOf({ status: response.status, body: response.body, from })
  if (refused !== null) {
    if (response.status === HTTP_STATUSES.rangeNotSatisfiable) await part.truncate()
    return refused
  }
  const plan = planFor({
    status: response.status,
    from,
    rangeStart: contentRangeStart(response.headers.get(HEADERS.contentRange)),
  })
  switch (plan) {
    case PLANS.append:
      return streamToPart({
        ...input,
        body: response.body,
        from,
        promised: promisedSize({ from, headers: response.headers }),
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
      return { ok: false, reason: FETCH_REASONS.status, status: response.status, bytes: from }
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
export const fetchToFile = async ({
  stallMs = DOWNLOAD_STALL_MS,
  ...input
}: FetchToFileProps): Promise<FetchOutcome> => {
  try {
    return await download({ ...input, stallMs, canRestart: true })
  } finally {
    // A file that will not close changes nothing the outcome says: the next resume reads the size from disk.
    await input.part.close().catch(() => undefined)
  }
}
