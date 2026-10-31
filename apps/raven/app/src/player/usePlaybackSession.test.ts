import { describe, expect, it } from 'bun:test'
import { ACCESS_REFUSALS, type AccessRefusal, PLAYBACK_MODES, type PlaybackMode } from '@raven/core'
import type { SourceOutcome } from '@raven/native/headless'

import {
  SESSION_COPY,
  SESSION_EVENTS,
  SESSION_PHASES,
  type SessionState,
  hasWayBelow,
  initialSession,
  modeOf,
  isOpeningOf,
  noticeOf,
  sessionReducer,
  sourcedOf,
} from '@/player/usePlaybackSession'

const { direct, remux, transcode } = PLAYBACK_MODES
const LADDER: readonly PlaybackMode[] = [direct, remux, transcode]
const RESUME_AT = 3000
const MKV_PROBLEM = "The MKV container isn't supported here."

const SOURCED: SourceOutcome = {
  ok: true,
  source: { uri: 'http://nas:8080/api/media/20/file', headers: {} },
}

const LOCKED: AccessRefusal = {
  ok: false,
  reason: ACCESS_REFUSALS.locked,
  message: "This video's library on nas:8080 is locked.",
}

type OpenedProps = {
  modes?: readonly PlaybackMode[]
  at?: number
  problems?: readonly string[]
}

const opened = ({
  modes = LADDER,
  at = RESUME_AT,
  problems = [],
}: OpenedProps = {}): SessionState => initialSession({ modes, at, audio: null, problems })

/** The attempt a state is on, which events for it must name. */
const attemptOf = (state: SessionState): number =>
  state.phase === SESSION_PHASES.failed ? -1 : state.attempt

const sourced = (state: SessionState): SessionState =>
  sessionReducer(state, {
    type: SESSION_EVENTS.sourced,
    attempt: attemptOf(state),
    outcome: SOURCED,
  })

const loaded = (state: SessionState): SessionState =>
  sessionReducer(state, { type: SESSION_EVENTS.loaded, attempt: attemptOf(state) })

type FailedProps = { state: SessionState; at: number }

const failed = ({ state, at }: FailedProps): SessionState =>
  sessionReducer(state, { type: SESSION_EVENTS.failed, attempt: attemptOf(state), at })

describe('the playback ladder', () => {
  it("starts at the plan's first mode, from the resume spot, asking for its source", () => {
    const state = opened()
    expect(state).toMatchObject({ phase: SESSION_PHASES.sourcing, at: RESUME_AT, attempt: 0 })
    expect(modeOf(state)).toBe(direct)
  })

  it('reloads the remux from the same spot when direct play fails', () => {
    const playing = loaded(sourced(opened()))
    expect(playing.phase).toBe(SESSION_PHASES.playing)
    const next = failed({ state: playing, at: 3125.5 })
    expect(next).toMatchObject({ phase: SESSION_PHASES.sourcing, at: 3125.5, attempt: 1 })
    expect(modeOf(next)).toBe(remux)
  })

  it('goes to the transcode when the server refuses the remux, as its 409 does', () => {
    const next = failed({ state: sourced(opened({ modes: [remux, transcode] })), at: RESUME_AT })
    expect(modeOf(next)).toBe(transcode)
    expect(next).toMatchObject({ phase: SESSION_PHASES.sourcing, at: RESUME_AT })
  })

  it('steps down when the player has not loaded in time, and only for the load it timed', () => {
    const loading = sourced(opened())
    const stale = sessionReducer(loading, { type: SESSION_EVENTS.timedOut, attempt: 7 })
    expect(stale).toBe(loading)
    const next = sessionReducer(loading, {
      type: SESSION_EVENTS.timedOut,
      attempt: attemptOf(loading),
    })
    expect(modeOf(next)).toBe(remux)
    expect(next).toMatchObject({ at: RESUME_AT, attempt: 1 })
    const playing = loaded(sourced(opened()))
    expect(
      sessionReducer(playing, { type: SESSION_EVENTS.timedOut, attempt: attemptOf(playing) }),
    ).toBe(playing)
  })

  it('gives the last way all the time it takes, as a transcode on a NAS may need, but not one with a way below', () => {
    const transcoding = sourced(opened({ modes: [remux, transcode] }))
    const lastWay = failed({ state: transcoding, at: RESUME_AT })
    const loadingLast = sourced(lastWay)
    expect(modeOf(loadingLast)).toBe(transcode)
    expect(hasWayBelow(loadingLast)).toBe(false)
    expect(
      sessionReducer(loadingLast, {
        type: SESSION_EVENTS.timedOut,
        attempt: attemptOf(loadingLast),
      }),
    ).toBe(loadingLast)
    expect(hasWayBelow(transcoding)).toBe(true)
    const next = sessionReducer(transcoding, {
      type: SESSION_EVENTS.timedOut,
      attempt: attemptOf(transcoding),
    })
    expect(modeOf(next)).toBe(transcode)
  })

  it('ignores what an earlier load says once the ladder has moved on', () => {
    const playing = loaded(sourced(opened()))
    expect(sessionReducer(playing, { type: SESSION_EVENTS.failed, attempt: 9, at: 10 })).toBe(
      playing,
    )
  })

  it("says every way has failed, then gives the plan's problems", () => {
    const lastWay = sourced(opened({ modes: [transcode], problems: [MKV_PROBLEM] }))
    expect(failed({ state: lastWay, at: 12 })).toEqual({
      phase: SESSION_PHASES.failed,
      problems: [SESSION_COPY.exhausted, MKV_PROBLEM],
    })
    expect(failed({ state: sourced(opened({ modes: [direct] })), at: 12 })).toEqual({
      phase: SESSION_PHASES.failed,
      problems: [SESSION_COPY.exhausted],
    })
  })

  it('has nothing to try for a plan with no way to play', () => {
    expect(opened({ modes: [], problems: [MKV_PROBLEM] })).toEqual({
      phase: SESSION_PHASES.failed,
      problems: [MKV_PROBLEM],
    })
    expect(opened({ modes: [] })).toEqual({
      phase: SESSION_PHASES.failed,
      problems: [SESSION_COPY.noWay],
    })
  })

  it('holds a refusal, and asks again in the same way once it is retried', () => {
    const state = opened()
    const refused = sessionReducer(state, {
      type: SESSION_EVENTS.sourced,
      attempt: attemptOf(state),
      outcome: LOCKED,
    })
    expect(refused).toMatchObject({ phase: SESSION_PHASES.refused, refusal: LOCKED })
    const retried = sessionReducer(refused, { type: SESSION_EVENTS.retried })
    expect(retried).toMatchObject({ phase: SESSION_PHASES.sourcing, attempt: 1, at: RESUME_AT })
    expect(modeOf(retried)).toBe(direct)
  })

  it('reloads a stream from the spot for another audio track, where direct play switches itself', () => {
    const streaming = loaded(sourced(opened({ modes: [remux, transcode] })))
    const picked = sessionReducer(streaming, {
      type: SESSION_EVENTS.audioPicked,
      audio: 1,
      at: 640,
    })
    expect(picked).toMatchObject({ phase: SESSION_PHASES.sourcing, audio: 1, at: 640, attempt: 1 })
    expect(modeOf(picked)).toBe(remux)
    const playing = loaded(sourced(opened()))
    expect(
      sessionReducer(playing, { type: SESSION_EVENTS.audioPicked, audio: 1, at: 640 }),
    ).toMatchObject({ phase: SESSION_PHASES.playing, audio: 1, attempt: 0 })
  })

  it('moves to the transcode to burn a picture subtitle in, and back to where it played once cleared', () => {
    const remuxing = loaded(
      sourced(sessionReducer(opened(), { type: SESSION_EVENTS.failed, attempt: 0, at: 30 })),
    )
    expect(modeOf(remuxing)).toBe(remux)
    const burning = sessionReducer(remuxing, {
      type: SESSION_EVENTS.burnPicked,
      burn: 'embedded-1',
      at: 640,
    })
    expect(burning).toMatchObject({ phase: SESSION_PHASES.sourcing, burn: 'embedded-1', at: 640 })
    expect(modeOf(burning)).toBe(transcode)
    const cleared = sessionReducer(loaded(sourced(burning)), {
      type: SESSION_EVENTS.burnPicked,
      burn: null,
      at: 700,
    })
    expect(cleared).toMatchObject({ phase: SESSION_PHASES.sourcing, burn: null, at: 700 })
    expect(modeOf(cleared)).toBe(remux)
  })

  it('burns nothing where the plan holds no transcode, as when transcoding is off', () => {
    const remuxOnly = loaded(sourced(opened({ modes: [direct, remux] })))
    expect(
      sessionReducer(remuxOnly, { type: SESSION_EVENTS.burnPicked, burn: 'embedded-1', at: 640 }),
    ).toBe(remuxOnly)
  })

  it('says what stands in for the video until frames flow, and hands the source over meanwhile', () => {
    const asking = opened()
    expect([noticeOf(asking), isOpeningOf(asking), sourcedOf(asking)]).toEqual([null, true, null])
    const loading = sourced(asking)
    expect([noticeOf(loading), isOpeningOf(loading), sourcedOf(loading)]).toEqual([
      null,
      true,
      SOURCED,
    ])
    const playing = loaded(loading)
    expect([noticeOf(playing), sourcedOf(playing)]).toEqual([null, SOURCED])
    const refused = sessionReducer(asking, {
      type: SESSION_EVENTS.sourced,
      attempt: attemptOf(asking),
      outcome: LOCKED,
    })
    expect([noticeOf(refused), sourcedOf(refused)]).toEqual([LOCKED.message, null])
    expect(noticeOf(opened({ modes: [], problems: [MKV_PROBLEM, SESSION_COPY.noWay] }))).toBe(
      `${MKV_PROBLEM}\n${SESSION_COPY.noWay}`,
    )
  })
})

describe('the ladder when the server lets go of a source mid-play', () => {
  const ACCOUNT_REFUSED: AccessRefusal = {
    ok: false,
    reason: ACCESS_REFUSALS.account,
    message: 'Sign in to nas:8080 again.',
  }

  type DroppedProps = { state: SessionState; at: number }

  const dropped = ({ state, at }: DroppedProps): SessionState =>
    sessionReducer(state, { type: SESSION_EVENTS.dropped, attempt: attemptOf(state), at })

  it('opens the same way again from the spot reached, for a source to be handed out afresh', () => {
    const streaming = loaded(sourced(opened({ modes: [remux, transcode] })))
    const reopened = dropped({ state: streaming, at: 4210.5 })
    expect(reopened).toMatchObject({ phase: SESSION_PHASES.sourcing, at: 4210.5, attempt: 1 })
    expect(modeOf(reopened)).toBe(remux)
    const filePlay = dropped({ state: loaded(sourced(opened())), at: 3301 })
    expect(modeOf(filePlay)).toBe(direct)
    expect(filePlay).toMatchObject({ phase: SESSION_PHASES.sourcing, at: 3301, attempt: 1 })
  })

  it('reopens again once the reopened way has played on, for as long as a film lasts', () => {
    const first = dropped({ state: loaded(sourced(opened({ modes: [remux] }))), at: 600 })
    const second = dropped({ state: loaded(sourced(first)), at: 1800 })
    expect(modeOf(second)).toBe(remux)
    expect(second).toMatchObject({ phase: SESSION_PHASES.sourcing, at: 1800, attempt: 2 })
  })

  it('steps down from a reopened way that lets go again before it has played on, as a real failure', () => {
    const reopened = dropped({
      state: loaded(sourced(opened({ modes: [remux, transcode] }))),
      at: 600,
    })
    const again = dropped({ state: loaded(sourced(reopened)), at: 600 })
    expect(modeOf(again)).toBe(transcode)
    expect(again).toMatchObject({ phase: SESSION_PHASES.sourcing, at: 600 })
  })

  it('steps down from a source the server lets go of before it ever loaded', () => {
    const next = dropped({ state: sourced(opened({ modes: [remux, transcode] })), at: RESUME_AT })
    expect(modeOf(next)).toBe(transcode)
  })

  it('shows the refusal when the reopen itself is refused, and ignores an earlier source', () => {
    const playing = loaded(sourced(opened({ modes: [remux, transcode] })))
    expect(sessionReducer(playing, { type: SESSION_EVENTS.dropped, attempt: 7, at: 900 })).toBe(
      playing,
    )
    const reopened = dropped({ state: playing, at: 900 })
    const refused = sessionReducer(reopened, {
      type: SESSION_EVENTS.sourced,
      attempt: attemptOf(reopened),
      outcome: ACCOUNT_REFUSED,
    })
    expect(refused).toMatchObject({ phase: SESSION_PHASES.refused, refusal: ACCOUNT_REFUSED })
    expect(noticeOf(refused)).toBe(ACCOUNT_REFUSED.message)
    expect(modeOf(refused)).toBe(remux)
  })
})
