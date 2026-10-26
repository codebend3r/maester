import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  type Account,
  DEFAULT_PLAYBACK_SETTINGS,
  MEDIA_TICKET_SECONDS,
  MEMBER_STATUSES,
  PLAYBACK_MODES,
  QUALITIES,
  VIDEO_CODECS,
} from '@raven/core'
import { NEVER, Subject } from 'rxjs'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { ACCOUNT_PASS_MS, type PassAccess } from '@/auth/accountPasses'
import { SOFTWARE } from '@/ffmpeg/encoder'
import { FfmpegService } from '@/ffmpeg/ffmpegService'
import { HLS_CAPABILITY_PREFIX, isHlsCapability } from '@/hls/hlsCapability'
import { HLS_SESSION_CAP, type HlsSession, HlsSessions } from '@/hls/hlsSessions'
import { type SegmentPlan, remuxPlan } from '@/hls/segmentPlan'
import { testConfig } from '@/test/app'
import { AUTH_TEST_IDS } from '@/test/auth'
import { manualClock } from '@/test/clock'
import { encodeClip } from '@/test/clips'

const FRIEND: Account = {
  id: AUTH_TEST_IDS.friend,
  email: 'friend@maester.test',
  status: MEMBER_STATUSES.approved,
  isOwner: false,
}

type AccessOfProps = { ended?: Subject<void> }

/** Access for the friend that ends when `ended` emits. */
const accessOf = ({ ended = new Subject<void>() }: AccessOfProps = {}) => ({
  ended,
  access: {
    account: FRIEND,
    unlockedUntil: null,
    ended,
    relocked: NEVER,
    needsUnlock: () => false,
  },
})

/**
 * The sessions an account's ticket opens, and the pass each holds. Nothing
 * here reads a segment, so one short clip does, though a run may start on
 * it as the clock moves past the init's grace.
 */
describe("an account's HLS session", () => {
  const state: { root: string; clip: string; plan: SegmentPlan; dataDirs: number } = {
    root: '',
    clip: '',
    plan: { boundaries: [], duration: 0 },
    dataDirs: 0,
  }
  const opened: HlsSessions[] = []

  const ffmpegFor = (dataDir: string) =>
    new FfmpegService(testConfig({ dataDir, mediaDir: state.root }), {
      playback: () => DEFAULT_PLAYBACK_SETTINGS,
    })

  beforeAll(async () => {
    state.root = await mkdtemp(join(tmpdir(), 'raven-hls-passes-'))
    state.clip = join(state.root, 'clip.mp4')
    await encodeClip({ path: state.clip, seconds: 2 })
    const ffmpeg = ffmpegFor(join(state.root, 'probe'))
    const [keyframes, { probe }] = await Promise.all([
      ffmpeg.probeKeyframes(state.clip),
      ffmpeg.probeFile(state.clip),
    ])
    const plan = remuxPlan({ keyframes, duration: probe.duration ?? 0 })
    if (!plan) throw new Error('No remux plan for the clip')
    state.plan = plan
  })

  afterEach(async () => {
    await Promise.all(opened.splice(0).map((sessions) => sessions.onModuleDestroy()))
  })

  afterAll(async () => {
    await rm(state.root, { recursive: true, force: true })
  })

  const open = () => {
    state.dataDirs += 1
    const dataDir = join(state.root, `data-${state.dataDirs}`)
    const { clock, advance } = manualClock()
    const config = testConfig({ dataDir, mediaDir: state.root })
    const sessions = new HlsSessions(config, ffmpegFor(dataDir), clock)
    sessions.onModuleInit()
    opened.push(sessions)
    return { sessions, advance }
  }

  type MintInProps = {
    sessions: HlsSessions
    mediaId?: number
    access?: PassAccess | null
  }

  const mintIn = ({ sessions, mediaId = 1, access = null }: MintInProps): HlsSession =>
    sessions.mint({
      mediaId,
      asked: null,
      source: {
        input: state.clip,
        mode: PLAYBACK_MODES.remux,
        plan: state.plan,
        startTime: 0,
        frameRate: 24,
        audio: null,
        videoCodec: VIDEO_CODECS.h264,
        encoder: SOFTWARE,
        maxHeight: 1080,
        quality: QUALITIES.medium,
        bitrate: null,
        tonemap: false,
      },
      keyframesFor: null,
      access,
    })

  it('gives each a capability of its own, which opens that session of that media alone', () => {
    const { sessions } = open()
    const first = mintIn({ sessions, access: accessOf().access })
    const second = mintIn({ sessions, access: accessOf().access })
    const plain = mintIn({ sessions })
    const firstKey = first.capability ?? ''
    const secondKey = second.capability ?? ''

    expect(isHlsCapability(firstKey)).toBe(true)
    expect(firstKey.startsWith(HLS_CAPABILITY_PREFIX)).toBe(true)
    expect(firstKey).not.toBe(secondKey)
    expect(plain.capability).toBeNull()
    expect(sessions.grantOf({ mediaId: 1, session: first.id, capability: firstKey })).toEqual({
      account: FRIEND,
      unlockedUntil: null,
    })
    expect([
      sessions.grantOf({ mediaId: 1, session: first.id, capability: secondKey }),
      sessions.grantOf({ mediaId: 2, session: first.id, capability: firstKey }),
      sessions.grantOf({ mediaId: 1, session: second.id, capability: firstKey }),
      sessions.grantOf({ mediaId: 1, session: plain.id, capability: firstKey }),
    ]).toEqual([null, null, null, null])
    expect(sessions.get({ mediaId: 1, session: first.id, key: firstKey })).toMatchObject({
      id: first.id,
    })
    expect(
      [undefined, secondKey, firstKey.toUpperCase(), [firstKey]].map((key) =>
        sessions.get({ mediaId: 1, session: first.id, key }),
      ),
    ).toEqual([null, null, null, null])
    expect(sessions.get({ mediaId: 1, session: plain.id, key: firstKey })).not.toBeNull()
  })

  it('ends the session when its access ends, and forgets the capability with it', () => {
    const { sessions } = open()
    const { ended, access } = accessOf()
    const session = mintIn({ sessions, access })
    const capability = session.capability ?? ''

    ended.next()

    expect(sessions.get({ mediaId: 1, session: session.id, key: capability })).toBeNull()
    expect(sessions.grantOf({ mediaId: 1, session: session.id, capability })).toBeNull()
  })

  it('ends the session at its capability deadline, however often the capability was used', () => {
    const { sessions, advance } = open()
    const { ended, access } = accessOf()
    const session = mintIn({ sessions, access })
    const plain = mintIn({ sessions })
    const capability = session.capability ?? ''
    /** An hour: well inside the forget, so only the deadline can end the session. */
    const HOUR_MS = 60 * 60 * 1000
    const isOpen = () => ({
      capability: sessions.get({ mediaId: 1, session: session.id, key: capability }) !== null,
      plain: sessions.get({ mediaId: 1, session: plain.id }) !== null,
    })
    const hourly = Array.from({ length: ACCOUNT_PASS_MS / HOUR_MS - 1 }, () => {
      advance(HOUR_MS)
      return isOpen()
    })
    advance(HOUR_MS - 1)
    const justBefore = isOpen()
    advance(1)

    expect(hourly).toEqual(hourly.map(() => ({ capability: true, plain: true })))
    expect(justBefore).toEqual({ capability: true, plain: true })
    expect(isOpen()).toEqual({ capability: false, plain: true })
    expect(sessions.grantOf({ mediaId: 1, session: session.id, capability })).toBeNull()
    expect(ended.observed).toBe(false)
  })

  it('stops watching its access once the session goes another way', () => {
    const { sessions, advance } = open()
    const dropped = accessOf()
    const forgotten = accessOf()
    const evicted = accessOf()
    const kept = accessOf()
    mintIn({ sessions, access: forgotten.access })
    advance(MEDIA_TICKET_SECONDS * 1000)
    mintIn({ sessions, access: evicted.access })
    advance(1)
    mintIn({ sessions, mediaId: 2, access: dropped.access })
    advance(1)
    Array.from({ length: HLS_SESSION_CAP - 2 }, () => mintIn({ sessions }))
    sessions.drop({ mediaId: 2 })
    mintIn({ sessions })
    // The ninth: the cap drops the longest idle, the first left.
    mintIn({ sessions, access: kept.access })

    expect([dropped, forgotten, evicted, kept].map(({ ended }) => ended.observed)).toEqual([
      false,
      false,
      false,
      true,
    ])
  })
})
