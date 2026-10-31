import { describe, expect, it } from 'bun:test'
import { MEDIA_PROBE_BYTES, MEDIA_PROBE_TIMEOUT_MS } from '@raven/core'

import { probeFetchOf } from '@/servers/mediaProbe'
import { FETCH_CREDENTIALS } from '@/servers/serverFetch'
import { LAN, mediaServer } from '@/test/mediaServer'

const PING = mediaServer({}).api.pingUrl({ origin: LAN })

/** A route the app never calls: a library's scan, which is the owner's. */
const SCAN = `${LAN.url}/api/libraries/1/scan`

type Sent = { url: string; credentials: string; isAborted: () => boolean }

/** A clock that reads `times` in turn, the last one standing for every read after it. */
const clockOf = (times: readonly number[]) => {
  let reads = 0
  return () => {
    const time = times[Math.min(reads, times.length - 1)] ?? 0
    reads += 1
    return time
  }
}

type PingFetchProps = { ok?: boolean; size?: number }

const pingFetch = ({ ok = true, size = MEDIA_PROBE_BYTES }: PingFetchProps) => {
  const sent: Sent[] = []
  let blobs = 0
  type FetchProps = { signal: AbortSignal; credentials: typeof FETCH_CREDENTIALS.omit }

  const fetch = async (url: string, init: FetchProps) => {
    sent.push({ url, credentials: init.credentials, isAborted: () => init.signal.aborted })
    return {
      ok,
      blob: async () => {
        blobs += 1
        return { size }
      },
    }
  }
  return { fetch, sent, blobs: () => blobs }
}

describe('probeFetchOf', () => {
  it('times the whole ping and counts its bytes, with no cookie', async () => {
    const ping = pingFetch({})
    const probe = probeFetchOf({ fetch: ping.fetch, clock: clockOf([100, 135]) })
    expect(await probe({ url: PING, timeoutMs: MEDIA_PROBE_TIMEOUT_MS })).toEqual({
      ok: true,
      bytes: MEDIA_PROBE_BYTES,
      elapsedMs: 35,
    })
    expect(ping.sent.map(({ url, credentials }) => ({ url, credentials }))).toEqual([
      { url: PING, credentials: FETCH_CREDENTIALS.omit },
    ])
  })

  it('reads no body from a ping that refused', async () => {
    const ping = pingFetch({ ok: false })
    const probe = probeFetchOf({ fetch: ping.fetch, clock: clockOf([0]) })
    expect(await probe({ url: PING, timeoutMs: MEDIA_PROBE_TIMEOUT_MS })).toEqual({
      ok: false,
      bytes: 0,
      elapsedMs: 0,
    })
    expect(ping.blobs()).toBe(0)
  })

  it('gives up on a ping that outlasts its time, and aborts it', async () => {
    const sent: Sent[] = []
    const probe = probeFetchOf({
      fetch: (url, init) => {
        sent.push({ url, credentials: init.credentials, isAborted: () => init.signal.aborted })
        return new Promise(() => undefined)
      },
      clock: clockOf([0]),
    })
    await expect(probe({ url: PING, timeoutMs: 5 })).rejects.toThrow('The ping took too long')
    expect(sent.map(({ isAborted }) => isAborted())).toEqual([true])
  })

  it("never pings an address outside the app's calls", async () => {
    const ping = pingFetch({})
    const probe = probeFetchOf({ fetch: ping.fetch, clock: clockOf([0]) })
    await expect(probe({ url: SCAN, timeoutMs: MEDIA_PROBE_TIMEOUT_MS })).rejects.toThrow(
      `raven's app does not call GET ${SCAN}`,
    )
    expect(ping.sent).toEqual([])
  })
})
