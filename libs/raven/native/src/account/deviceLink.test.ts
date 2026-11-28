import { describe, expect, it } from 'bun:test'
import { DEVICE_CLAIM_STATUSES, type DeviceClaim } from '@raven/core'

import { DEVICE_LINK_STATES, type DeviceLink, watchDeviceSignIn } from '@/account/deviceLink'

const SESSION = {
  accessToken: 'access',
  refreshToken: 'refresh',
  expiresIn: 3600,
  userId: 'user-1',
  email: 'friend@maester.test',
}

const PENDING: DeviceClaim = { status: DEVICE_CLAIM_STATUSES.pending }
const GONE: DeviceClaim = { status: DEVICE_CLAIM_STATUSES.gone }
const APPROVED: DeviceClaim = { status: DEVICE_CLAIM_STATUSES.approved, session: SESSION }

type WatchProps = {
  codes: readonly (string | null)[]
  answers: readonly (DeviceClaim | null)[]
  stopAfterAsks?: number
}

/** A watch on a clock that only `wait` moves, over the codes and answers handed out in order. */
const watch = async ({ codes, answers, stopAfterAsks = Infinity }: WatchProps) => {
  const links: (DeviceLink | null)[] = []
  const asked: string[] = []
  const clock = { now: 0, opens: 0 }
  const session = await watchDeviceSignIn({
    open: async () => {
      const code = codes[clock.opens] ?? null
      clock.opens += 1
      if (code === null) return null
      const deviceCode = `device-${code}`
      return {
        deviceCode,
        userCode: code,
        expiresInMs: 20_000,
        pollMs: 5000,
        webUrl: 'https://raven.example',
        claim: async () => {
          asked.push(deviceCode)
          return answers[asked.length - 1] ?? PENDING
        },
      }
    },
    wait: async (ms) => {
      clock.now += ms
    },
    now: () => clock.now,
    isStopped: () => asked.length >= stopAfterAsks,
    onLink: (link) => links.push(link),
  })
  return { session, links, asked, opens: clock.opens }
}

describe('watchDeviceSignIn', () => {
  it('shows the code, what the QR holds and the address to type, and answers the session once approved', async () => {
    const { session, links, asked } = await watch({
      codes: ['BCDFGHJK'],
      answers: [PENDING, null, APPROVED],
    })
    expect(session).toEqual(SESSION)
    expect(links).toEqual([
      {
        kind: DEVICE_LINK_STATES.ready,
        code: 'BCDF-GHJK',
        url: 'https://raven.example/link?code=BCDF-GHJK',
        address: 'raven.example/link',
      },
    ])
    expect(asked).toEqual(['device-BCDFGHJK', 'device-BCDFGHJK', 'device-BCDFGHJK'])
  })

  it('shows nothing where the server offers no code', async () => {
    const { session, links, asked } = await watch({ codes: [null], answers: [] })
    expect(session).toBeNull()
    expect(links).toEqual([null])
    expect(asked).toEqual([])
  })

  it('follows a spent code with a new one', async () => {
    const { session, links } = await watch({
      codes: ['BCDFGHJK', 'LMNPQRST'],
      answers: [GONE, APPROVED],
    })
    expect(session).toEqual(SESSION)
    expect(
      links.map((link) => (link?.kind === DEVICE_LINK_STATES.ready ? link.code : link)),
    ).toEqual(['BCDF-GHJK', 'LMNP-QRST'])
  })

  it('stops asking after three codes ran out, and says the code expired', async () => {
    const { session, links, opens, asked } = await watch({
      codes: ['BCDFGHJK', 'LMNPQRST', 'VWXZBCDF', 'GHJKLMNP'],
      answers: [],
    })
    expect(session).toBeNull()
    expect(opens).toBe(3)
    // Each code is asked about every five seconds until its twenty are up.
    expect(asked).toHaveLength(9)
    expect(links.at(-1)).toEqual({ kind: DEVICE_LINK_STATES.expired })
  })

  it('asks and says nothing more once the screen has gone', async () => {
    const { session, links, asked } = await watch({
      codes: ['BCDFGHJK', 'LMNPQRST'],
      answers: [PENDING, APPROVED],
      stopAfterAsks: 1,
    })
    expect(session).toBeNull()
    expect(asked).toHaveLength(1)
    expect(links).toHaveLength(1)
  })
})
