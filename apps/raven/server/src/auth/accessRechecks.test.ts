import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Logger } from '@nestjs/common'
import {
  AUTH_REFUSALS,
  DEFAULT_PLAYBACK_SETTINGS,
  MEMBER_STATUSES,
  PLAYBACK_MODES,
  QUALITIES,
  VIDEO_CODECS,
  type Account,
} from '@raven/core'
import { decodeJwt } from 'jose'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AccessRechecks } from '@/auth/accessRechecks'
import { AuthBackend } from '@/auth/authBackend'
import { AuthSessions, REMEMBERED_ACCOUNTS } from '@/auth/authSessions'
import { MEMBERSHIP_TTL_MS, MembershipLookups } from '@/auth/membershipLookups'
import type { createTokenVerifier } from '@/auth/tokenVerifier'
import { SOFTWARE } from '@/ffmpeg/encoder'
import { FfmpegService } from '@/ffmpeg/ffmpegService'
import type { HlsSource } from '@/ffmpeg/hlsArgs'
import { HlsSessions } from '@/hls/hlsSessions'
import { FilePasses } from '@/media/filePasses'
import { testConfig } from '@/test/app'
import { AUTH_TEST_CONFIG, AUTH_TEST_FAILURES, AUTH_TEST_IDS, authFixture } from '@/test/auth'
import { STILL_CLOCK } from '@/test/clock'

const RECHECK_MS = 60_000
/** Longer than one recheck, so a test sees a recheck pass before the token runs out. */
const TOKEN_SECONDS = 90
const TOKEN_MS = TOKEN_SECONDS * 1000
const START = new Date('2026-10-19T12:00:00.000Z')

/**
 * Reads the fixture's tokens without checking their signatures. WebCrypto
 * settles outside fake time, so a recheck through the real verifier would
 * still be pending when a test advances the clock past it.
 */
const decodingVerifier: ReturnType<typeof createTokenVerifier> = async ({ token }) => {
  const { sub, exp } = decodeJwt(token)
  if (sub === undefined || exp === undefined) throw new Error('The fixture minted a bare token')
  return { id: sub, expiresAt: exp * 1000 }
}

const setup = async () => {
  const fixture = await authFixture()
  const sessions = new AuthSessions(
    decodingVerifier,
    new MembershipLookups(new AuthBackend(AUTH_TEST_CONFIG, fixture.fetcher), MEMBERSHIP_TTL_MS),
  )
  const rechecks = new AccessRechecks(sessions, RECHECK_MS)
  const signIn = async ({ expiresIn = TOKEN_SECONDS }: { expiresIn?: number } = {}) =>
    sessions.authenticate({ token: await fixture.mint({ id: AUTH_TEST_IDS.friend, expiresIn }) })
  /** A request the account gate bound to the friend's session, and what its recheck saw. */
  const watch = async () => {
    const request = {}
    const session = await signIn()
    sessions.bindSession({ request, session, isBearer: true })
    const seen = { isEnded: false, isComplete: false }
    const subscription = rechecks.ended({ request }).subscribe({
      next: () => {
        seen.isEnded = true
      },
      complete: () => {
        seen.isComplete = true
      },
    })
    return { seen, subscription, token: session.token }
  }
  const setStatus = ({ status }: { status: Account['status'] }) => {
    const friend = fixture.accounts[AUTH_TEST_IDS.friend]
    if (friend === undefined) throw new Error('Missing friend fixture')
    fixture.accounts[AUTH_TEST_IDS.friend] = { ...friend, status }
  }
  return { fixture, sessions, rechecks, signIn, watch, setStatus }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(START)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('rechecks of an open response', () => {
  it('stays quiet while the account is approved, checking it again each interval', async () => {
    const { fixture, watch } = await setup()
    const { seen, subscription } = await watch()
    fixture.fetcher.mockClear()
    await vi.advanceTimersByTimeAsync(RECHECK_MS)
    expect(fixture.fetcher).toHaveBeenCalled()
    expect(seen).toEqual({ isEnded: false, isComplete: false })
    subscription.unsubscribe()
  })

  it('ends at the next recheck once the account is removed', async () => {
    const { watch, setStatus } = await setup()
    const { seen } = await watch()
    await vi.advanceTimersByTimeAsync(RECHECK_MS / 2)
    setStatus({ status: MEMBER_STATUSES.revoked })
    await vi.advanceTimersByTimeAsync(RECHECK_MS / 2 - 1)
    expect(seen.isEnded).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(seen).toEqual({ isEnded: true, isComplete: true })
  })

  it('ends a ticket caller at the next recheck once the account is removed', async () => {
    const { sessions, rechecks, signIn, setStatus } = await setup()
    const request = {}
    sessions.bindTicket({ request, session: await signIn(), unlockedUntil: null })
    const seen = { isEnded: false }
    rechecks.ended({ request }).subscribe(() => {
      seen.isEnded = true
    })
    setStatus({ status: MEMBER_STATUSES.revoked })
    await vi.advanceTimersByTimeAsync(RECHECK_MS)
    expect(seen.isEnded).toBe(true)
  })

  it('keeps the response through an outage until the token expiry, warning without the token', async () => {
    const { fixture, watch } = await setup()
    const warn = vi.spyOn(Logger.prototype, 'warn')
    const { seen, token } = await watch()
    fixture.fetcher.mockRejectedValue(new Error('Network unavailable'))
    await vi.advanceTimersByTimeAsync(TOKEN_MS - 1)
    expect(seen.isEnded).toBe(false)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(AUTH_REFUSALS.unavailable))
    expect(warn.mock.calls.flat().join(' ')).not.toContain(token)
    await vi.advanceTimersByTimeAsync(1)
    expect(seen).toEqual({ isEnded: true, isComplete: true })
    warn.mockRestore()
  })

  it('ends at once on a removal seen once an outage is over', async () => {
    const { fixture, watch, setStatus } = await setup()
    const { seen } = await watch()
    fixture.state.failure = AUTH_TEST_FAILURES.network
    await vi.advanceTimersByTimeAsync(RECHECK_MS)
    expect(seen.isEnded).toBe(false)
    fixture.state.failure = AUTH_TEST_FAILURES.none
    setStatus({ status: MEMBER_STATUSES.revoked })
    await vi.advanceTimersByTimeAsync(RECHECK_MS / 4)
    expect(seen.isEnded).toBe(false)
    await vi.advanceTimersByTimeAsync((RECHECK_MS * 3) / 4)
    expect(seen.isEnded).toBe(true)
  })

  it('ends at the next recheck when the lookup answers for another account', async () => {
    const { fixture, watch } = await setup()
    const { seen } = await watch()
    fixture.state.failure = AUTH_TEST_FAILURES.wrongAccount
    await vi.advanceTimersByTimeAsync(RECHECK_MS)
    expect(seen).toEqual({ isEnded: true, isComplete: true })
  })

  it.each([AUTH_TEST_FAILURES.ambiguous, AUTH_TEST_FAILURES.malformed])(
    'ends at the next recheck when the lookup answers with rows it cannot trust: %s',
    async (failure) => {
      const { fixture, watch } = await setup()
      const { seen } = await watch()
      fixture.state.failure = failure
      await vi.advanceTimersByTimeAsync(RECHECK_MS)
      expect(seen).toEqual({ isEnded: true, isComplete: true })
    },
  )

  it('ends at the token expiry when no fresher token for the account was seen', async () => {
    const { watch } = await setup()
    const { seen } = await watch()
    await vi.advanceTimersByTimeAsync(TOKEN_MS - 1)
    expect(seen.isEnded).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(seen).toEqual({ isEnded: true, isComplete: true })
  })

  it('stays open past the expiry when the account sent a fresher token meanwhile', async () => {
    const { signIn, watch } = await setup()
    const { seen, subscription } = await watch()
    await vi.advanceTimersByTimeAsync(TOKEN_MS / 2)
    await signIn({ expiresIn: TOKEN_SECONDS * 4 })
    await vi.advanceTimersByTimeAsync(TOKEN_MS)
    expect(seen.isEnded).toBe(false)
    subscription.unsubscribe()
  })

  it('clears its timer when the response closes first', async () => {
    const { fixture, watch } = await setup()
    const { subscription } = await watch()
    expect(vi.getTimerCount()).toBe(1)
    subscription.unsubscribe()
    expect(vi.getTimerCount()).toBe(0)
    fixture.fetcher.mockClear()
    await vi.advanceTimersByTimeAsync(TOKEN_MS * 2)
    expect(fixture.fetcher).not.toHaveBeenCalled()
  })

  it('never ends a legacy caller, and sets no timer for one', async () => {
    const { rechecks } = await setup()
    const seen = { isEnded: false }
    const subscription = rechecks.ended({ request: {} }).subscribe(() => {
      seen.isEnded = true
    })
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(TOKEN_MS * 2)
    expect(seen.isEnded).toBe(false)
    subscription.unsubscribe()
  })
})

describe('the freshest token per account', () => {
  it('keeps the latest expiry of the tokens seen, and forgets it once it expires', async () => {
    const { sessions, signIn } = await setup()
    const later = await signIn({ expiresIn: TOKEN_SECONDS * 2 })
    await signIn()
    expect(sessions.freshestFor({ accountId: AUTH_TEST_IDS.friend })).toEqual({
      token: later.token,
      expiresAt: later.expiresAt,
    })
    vi.setSystemTime(later.expiresAt)
    expect(sessions.freshestFor({ accountId: AUTH_TEST_IDS.friend })).toBeNull()
    expect(sessions.freshestFor({ accountId: AUTH_TEST_IDS.owner })).toBeNull()
  })

  it('remembers a bounded number of accounts, dropping the soonest to expire', async () => {
    const { sessions, fixture } = await setup()
    const friend = fixture.accounts[AUTH_TEST_IDS.friend]
    if (friend === undefined) throw new Error('Missing friend fixture')
    const accountAt = (index: number): Account => ({
      ...friend,
      id: `30000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    })
    const accounts = Array.from({ length: REMEMBERED_ACCOUNTS + 1 }, (_, index) => accountAt(index))
    accounts.forEach((account, index) =>
      sessions.remember({
        account,
        token: `token-${index}`,
        expiresAt: START.getTime() + TOKEN_MS + index,
      }),
    )
    expect(sessions.freshestFor({ accountId: accountAt(0).id })).toBeNull()
    expect(sessions.freshestFor({ accountId: accountAt(1).id })).not.toBeNull()
    expect(sessions.freshestFor({ accountId: accountAt(REMEMBERED_ACCOUNTS).id })).not.toBeNull()
  })

  it('holds no token for an account waiting for approval', async () => {
    const { sessions, fixture } = await setup()
    await sessions.authenticate({ token: await fixture.mint({ id: AUTH_TEST_IDS.pending }) })
    expect(sessions.freshestFor({ accountId: AUTH_TEST_IDS.pending })).toBeNull()
  })

  it('ignores a token that has already expired', async () => {
    const { sessions, fixture } = await setup()
    const friend = fixture.accounts[AUTH_TEST_IDS.friend]
    if (friend === undefined) throw new Error('Missing friend fixture')
    sessions.remember({ account: friend, token: 'stale', expiresAt: START.getTime() })
    expect(sessions.freshestFor({ accountId: friend.id })).toBeNull()
  })
})

describe('an HLS session opened with an account ticket', () => {
  const SOURCE: HlsSource = {
    input: join(tmpdir(), 'raven-rechecks-clip.mkv'),
    mode: PLAYBACK_MODES.remux,
    plan: { boundaries: [0], duration: 6 },
    startTime: 0,
    frameRate: 24,
    audio: null,
    videoCodec: VIDEO_CODECS.h264,
    encoder: SOFTWARE,
    maxHeight: 1080,
    quality: QUALITIES.medium,
    bitrate: null,
    tonemap: false,
  }
  /** Each test's sessions and data folder, let go once it is done. */
  const made: { sessions: HlsSessions[]; dirs: string[] } = { sessions: [], dirs: [] }

  afterEach(async () => {
    await Promise.all(made.sessions.map((sessions) => sessions.onModuleDestroy()))
    await Promise.all(made.dirs.map((dir) => rm(dir, { recursive: true, force: true })))
    made.sessions = []
    made.dirs = []
  })

  /** A session minted as the master does for the friend's ticket, and whether its capability still opens it. */
  const minted = async () => {
    const env = await setup()
    const dataDir = await mkdtemp(join(tmpdir(), 'raven-rechecks-hls-'))
    const config = testConfig({ dataDir, mediaDir: tmpdir() })
    const hls = new HlsSessions(
      config,
      new FfmpegService(config, { playback: () => DEFAULT_PLAYBACK_SETTINGS }),
      // No session rests or is forgotten here: only its account's rechecks end it.
      STILL_CLOCK,
    )
    made.sessions = [...made.sessions, hls]
    made.dirs = [...made.dirs, dataDir]
    const request = {}
    const session = await env.signIn()
    env.sessions.bindTicket({ request, session, unlockedUntil: null })
    const opened = hls.mint({
      mediaId: 1,
      asked: null,
      source: SOURCE,
      keyframesFor: null,
      access: {
        account: session.account,
        unlockedUntil: null,
        ended: env.rechecks.ended({ request }),
      },
    })
    const isOpen = (): boolean =>
      hls.grantOf({ mediaId: 1, session: opened.id, capability: opened.capability ?? '' }) !== null
    return { ...env, isOpen }
  }

  it('ends the session at the next recheck once the account is removed', async () => {
    const { isOpen, setStatus } = await minted()
    await vi.advanceTimersByTimeAsync(RECHECK_MS / 2)
    setStatus({ status: MEMBER_STATUSES.revoked })
    await vi.advanceTimersByTimeAsync(RECHECK_MS / 2 - 1)
    expect(isOpen()).toBe(true)
    await vi.advanceTimersByTimeAsync(1)
    expect(isOpen()).toBe(false)
  })

  it('ends the session at the next recheck when the lookup answers for another account', async () => {
    const { fixture, isOpen } = await minted()
    fixture.state.failure = AUTH_TEST_FAILURES.wrongAccount
    await vi.advanceTimersByTimeAsync(RECHECK_MS)
    expect(isOpen()).toBe(false)
  })

  it('keeps the session through an outage until the last-known token expires', async () => {
    const { fixture, isOpen } = await minted()
    fixture.state.failure = AUTH_TEST_FAILURES.network
    await vi.advanceTimersByTimeAsync(TOKEN_MS - 1)
    expect(isOpen()).toBe(true)
    await vi.advanceTimersByTimeAsync(1)
    expect(isOpen()).toBe(false)
  })
})

describe("a direct file's pass, held by the account ticket that opened it", () => {
  const TICKET = 'account.0123456789abcdefghijklmnopqrstuvwxyzABCDEFG'
  const MEDIA = 1

  /** A pass held as the friend's ticket's first `file` request holds it, and whether it still opens the file. */
  const held = async () => {
    const env = await setup()
    // Only the account's rechecks end it here: its deadline never comes.
    const passes = new FilePasses(STILL_CLOCK, env.sessions, env.rechecks)
    const request = {}
    env.sessions.bindTicket({ request, session: await env.signIn(), unlockedUntil: null })
    passes.hold({ request, ticket: TICKET, mediaId: MEDIA })
    const isOpen = (): boolean => passes.grantOf({ ticket: TICKET, mediaId: MEDIA }) !== null
    return { ...env, isOpen }
  }

  it('ends the pass at the next recheck once the account is removed', async () => {
    const { isOpen, setStatus } = await held()
    await vi.advanceTimersByTimeAsync(RECHECK_MS / 2)
    setStatus({ status: MEMBER_STATUSES.revoked })
    await vi.advanceTimersByTimeAsync(RECHECK_MS / 2 - 1)
    expect(isOpen()).toBe(true)
    await vi.advanceTimersByTimeAsync(1)
    expect(isOpen()).toBe(false)
  })

  it('ends the pass at the next recheck when the lookup answers for another account', async () => {
    const { fixture, isOpen } = await held()
    fixture.state.failure = AUTH_TEST_FAILURES.wrongAccount
    await vi.advanceTimersByTimeAsync(RECHECK_MS - 1)
    expect(isOpen()).toBe(true)
    await vi.advanceTimersByTimeAsync(1)
    expect(isOpen()).toBe(false)
  })

  it('keeps the pass through an outage until the last-known token expires', async () => {
    const { fixture, isOpen } = await held()
    fixture.state.failure = AUTH_TEST_FAILURES.network
    await vi.advanceTimersByTimeAsync(TOKEN_MS - 1)
    expect(isOpen()).toBe(true)
    await vi.advanceTimersByTimeAsync(1)
    expect(isOpen()).toBe(false)
  })
})
