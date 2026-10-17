import { type ApiClient, MEDIA_PROBE_BYTES, type MediaOrigin, type OriginProbe } from '@raven/core'

export type ProbeFetch = (
  url: string,
  init: { signal: AbortSignal; cache: 'no-store' },
) => Promise<{ ok: boolean; body: ReadableStream<Uint8Array> | null }>

type ProbeInput = {
  api: ApiClient
  fetch: ProbeFetch
  now: () => number
  timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 2000

const countBytes = async ({
  reader,
  received,
}: {
  reader: ReadableStreamDefaultReader<Uint8Array>
  received: number
}): Promise<number> => {
  const { done, value } = await reader.read()
  if (done) return received
  return countBytes({ reader, received: received + value.length })
}

const measure = async ({
  origin,
  api,
  fetch,
  now,
  signal,
}: Omit<ProbeInput, 'timeoutMs'> & {
  origin: MediaOrigin
  signal: AbortSignal
}): Promise<OriginProbe | null> => {
  const startedAt = now()
  const response = await fetch(api.pingUrl({ origin }), { signal, cache: 'no-store' })
  if (!response.ok || !response.body) return null
  const reader = response.body.getReader()
  const first = await reader.read()
  const firstByteAt = now()
  if (first.done) return null
  const received = await countBytes({ reader, received: first.value.length })
  const doneAt = now()
  if (received < MEDIA_PROBE_BYTES) return null
  // A body that lands in one read has no measurable transfer time; a millisecond keeps the rate finite.
  const measuredMs = doneAt - firstByteAt
  const transferMs = measuredMs > 0 ? measuredMs : 1
  return {
    origin,
    firstByteMs: firstByteAt - startedAt,
    bytesPerSecond: received / (transferMs / 1000),
  }
}

/** Times a small download from `origin`; null when it cannot be had in `timeoutMs`. */
export const probeOrigin = async ({
  origin,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  ...input
}: ProbeInput & { origin: MediaOrigin }): Promise<OriginProbe | null> => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  // A fetch that ignores its signal would otherwise hold the probe past the timeout.
  const timedOut = new Promise<null>((resolve) =>
    controller.signal.addEventListener('abort', () => resolve(null), { once: true }),
  )
  try {
    return await Promise.race([measure({ origin, signal: controller.signal, ...input }), timedOut])
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

export const probeOrigins = async ({
  origins,
  ...input
}: ProbeInput & { origins: readonly MediaOrigin[] }): Promise<OriginProbe[]> => {
  const probes = await Promise.all(origins.map((origin) => probeOrigin({ origin, ...input })))
  return probes.filter((probe) => probe !== null)
}
