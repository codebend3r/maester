import { describe, expect, it } from 'bun:test'
import { MEDIA_PROBE_BYTES } from '@raven/core'

import { probeFetchOf } from '@/servers/mediaProbe'
import { FETCH_CREDENTIALS } from '@/servers/serverFetch'
import { LAN } from '@/test/mediaServer'

const PING = `${LAN.url}/api/media-origins/ping?bytes=${MEDIA_PROBE_BYTES}`

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

const pingFetch = ({ ok = true, size = MEDIA_PROBE_BYTES }: { ok?: boolean; size?: number }) => {
  const sent: Sent[] = []
  let blobs = 0
  const fetch = async (
    url: string,
    init: { signal: AbortSignal; credentials: typeof FETCH_CREDENTIALS.omit },
  ) => {
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
    expect(await probe({ url: PING, timeoutMs: 2000 })).toEqual({
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
    expect(await probe({ url: PING, timeoutMs: 2000 })).toEqual({
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
    await expect(
      probe({ url: `${LAN.url}/api/libraries/1/scan`, timeoutMs: 2000 }),
    ).rejects.toThrow(`raven's app does not call GET ${LAN.url}/api/libraries/1/scan`)
    expect(ping.sent).toEqual([])
  })
})
