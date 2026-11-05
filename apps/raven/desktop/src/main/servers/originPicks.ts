import {
  isMediaOrigins,
  MEDIA_PROBE_BYTES,
  MEDIA_PROBE_TIMEOUT_MS,
  type MediaOrigin,
  type OriginProbe,
  PICK_FRESH_MS,
  type PlayNetwork,
  pickOrigin,
  readMediaOrigins,
  toQueryString,
} from '@raven/core'
import type { ServerEntry } from '@/main/desktopConfig'
import { quietly } from '@/main/log/quietly'
import { parseJson } from '@/main/parseJson'
import { CALL_NAMES } from '@/main/servers/allowlist'
import { loggable, type ServerCalls } from '@/main/servers/serverCalls'
import { HTTP_STATUSES } from '@/shared/httpStatuses'

type ProbeFetchProps = {
  url: string
  timeoutMs: number
}

/**
 * Main builds this on `net.fetch`. It owns the timeout, which covers reading the body too: a probe
 * that fails rejects, and one that stalls past the timeout errors its body's read.
 */
export type ProbeFetch = (
  input: ProbeFetchProps,
) => Promise<{ ok: boolean; body: ReadableStream<Uint8Array> | null }>

type MeasureOriginProps = {
  origin: MediaOrigin
  probe: ProbeFetch
  clock: () => number
}

/**
 * Times the whole ping body as the web player's probe does: the first byte from the call, then the
 * body's bytes over the time from its first byte to its last. Null for an answer that is not 2xx or
 * whose body ends short of `MEDIA_PROBE_BYTES`; it rejects when the fetch fails or times out.
 */
const measureOrigin = async ({
  origin,
  probe,
  clock,
}: MeasureOriginProps): Promise<OriginProbe | null> => {
  const url = `${origin.url}/api/media-origins/ping?${toQueryString({ bytes: String(MEDIA_PROBE_BYTES) })}`
  const startedAt = clock()
  const response = await probe({ url, timeoutMs: MEDIA_PROBE_TIMEOUT_MS })
  if (response.body === null) return null
  const reader = response.body.getReader()
  const countFrom = async (received: number): Promise<number> => {
    const { done, value } = await reader.read()
    if (done) return received
    return countFrom(received + value.length)
  }
  try {
    if (!response.ok) return null
    const first = await reader.read()
    const firstByteAt = clock()
    if (first.done) return null
    const received = await countFrom(first.value.length)
    const doneAt = clock()
    if (received < MEDIA_PROBE_BYTES) return null
    // A body that lands in one read has no measurable transfer time; a millisecond keeps the rate finite.
    const measuredMs = doneAt - firstByteAt
    const transferMs = measuredMs > 0 ? measuredMs : 1
    return {
      origin,
      firstByteMs: firstByteAt - startedAt,
      bytesPerSecond: received / (transferMs / 1000),
    }
  } finally {
    // Lets go of a body left unread or broken off; one read to its end has nothing left to cancel.
    await reader.cancel().catch(() => undefined)
  }
}

/**
 * The origin a server listed, cut down to scheme, host and port, or null when it is
 * not a plain http or https address: `net.fetch` also reads `file:`, so the server's
 * word is never taken as it comes.
 */
const trustedOrigin = (origin: MediaOrigin): MediaOrigin | null => {
  try {
    const url = new URL(origin.url)
    const isWeb = url.protocol === 'http:' || url.protocol === 'https:'
    if (!isWeb || url.username !== '' || url.password !== '') return null
    return { kind: origin.kind, url: url.origin }
  } catch {
    return null
  }
}

/**
 * Where a server's media is fetched from and what that means for a play: the origin's address
 * (the pick's, or the server's own when none answers), the origin picked (null for the server's
 * own address), and what the server said of remote play (null when it said nothing).
 */
export type MediaPlace = Pick<PlayNetwork, 'remote'> & {
  url: string
  origin: MediaOrigin | null
}

export type OriginPicks = {
  /** The origin a server's media is fetched from: the pick, or the server's own address when none answers. */
  originOf: (server: ServerEntry) => Promise<string>
  /** The same pick as `originOf`, with the origin it is and the server's word on remote play. */
  placeOf: (server: ServerEntry) => Promise<MediaPlace>
  /** Lets go of the server's pick, so the next ask probes again: its origin went away, or the network moved. */
  forget: (serverId: string) => void
}

type CreateOriginPicksProps = {
  calls: Pick<ServerCalls, 'call'>
  probe: ProbeFetch
  /** Times the probes in monotonic milliseconds, so a wall clock that jumps never skews one. */
  probeClock: () => number
  /** The wall clock a pick ages by. */
  now: () => number
  warn: (message: string) => void
}

/**
 * What one probe came to: the origin picked, or none, whether the server listed an origin to
 * try, and what it said of remote play. A server that lists none (or nothing readable) is asked
 * again only once the pick ages.
 */
type Picked = Pick<MediaPlace, 'origin' | 'remote'> & { isListed: boolean }

type Held = { pick: Promise<Picked>; at: number }

/**
 * Where each server's media is fetched from, for the downloads and the relay alike: the origins
 * `getMediaOrigins` lists, probed at once and picked by core's `pickOrigin`. A pick is held for
 * `PICK_FRESH_MS`, as the web player holds its own, and shared by every ask meanwhile. When the
 * server listed origins and none answered, nothing is held, so an origin that comes back is used
 * by the next ask. No ticket is minted here: the ping is open.
 */
export const createOriginPicks = ({
  calls,
  probe,
  probeClock,
  now,
  warn,
}: CreateOriginPicksProps): OriginPicks => {
  let held: ReadonlyMap<string, Held> = new Map()

  /** A log line never fails a pick. */
  const safeWarn = quietly(warn)

  /** Never rejects: a pick is shared, so a rejected one would fail every ask that shares it. */
  const pickFor = async (server: ServerEntry): Promise<Picked> => {
    const reply = await calls
      .call({ serverId: server.id, call: { name: CALL_NAMES.getMediaOrigins } })
      .catch(() => null)
    const body =
      reply !== null && reply.ok && reply.status === HTTP_STATUSES.ok ? parseJson(reply.body) : null
    if (!isMediaOrigins(body)) {
      safeWarn(`${loggable(server.name)} did not list media origins Raven can read`)
      return { origin: null, isListed: false, remote: null }
    }
    const { origins, remote } = readMediaOrigins(body)
    const checked = origins.map((origin) => ({
      kind: origin.kind,
      trusted: trustedOrigin(origin),
    }))
    const refused = checked.filter((entry) => entry.trusted === null).map((entry) => entry.kind)
    if (refused.length > 0) {
      safeWarn(
        `${loggable(server.name)} listed media origins Raven does not trust: ${refused.join(', ')}`,
      )
    }
    const trusted = checked.flatMap((entry) => (entry.trusted === null ? [] : [entry.trusted]))
    const settled = await Promise.allSettled(
      trusted.map((origin) => measureOrigin({ origin, probe, clock: probeClock })),
    )
    const origin = pickOrigin(
      settled.flatMap((result) =>
        result.status === 'fulfilled' && result.value !== null ? [result.value] : [],
      ),
    )
    return { origin, isListed: trusted.length > 0, remote }
  }

  const isFresh = (entry: Held): boolean => {
    const age = now() - entry.at
    return age >= 0 && age < PICK_FRESH_MS
  }

  const forget = (serverId: string): void => {
    held = new Map([...held].filter(([id]) => id !== serverId))
  }

  const pickOf = (server: ServerEntry): Promise<Picked> => {
    const kept = held.get(server.id)
    if (kept !== undefined && isFresh(kept)) return kept.pick
    const at = now()
    // Every ask shares this one promise, so they settle in the order they asked.
    const pick: Promise<Picked> = pickFor(server).then((picked) => {
      // Origins listed and none answering: asks that came meanwhile shared it, the next probes again.
      const isNoneAnswering = picked.origin === null && picked.isListed
      if (isNoneAnswering && held.get(server.id)?.pick === pick) forget(server.id)
      return picked
    })
    held = new Map([...held, [server.id, { pick, at }]])
    return pick
  }

  const placeOf: OriginPicks['placeOf'] = async (server) => {
    const { origin, remote } = await pickOf(server)
    return { url: origin?.url ?? server.origin, origin, remote }
  }

  return {
    originOf: async (server) => (await placeOf(server)).url,
    placeOf,
    forget,
  }
}
