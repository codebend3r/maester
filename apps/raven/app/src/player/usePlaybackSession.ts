import { type AccessRefusal, type MediaItem, PLAYBACK_MODES, type PlaybackMode } from '@raven/core'
import { type MediaSources, type SourceOutcome, useCookieVersion } from '@raven/native/headless'
import { useEffect, useEffectEvent, useReducer } from 'react'

/** How long a source may take to load before the ladder steps down from it. */
export const LOAD_TIMEOUT_MS = 15_000

/**
 * How long a direct play may wait for data before it is opened again from the spot. The server
 * keeps a file's ticket opening it past the ticket's five minutes, so this is the safety net for
 * a pass that ended (its 12 hours, an account recheck, the pass cap, a restart) and for a stall
 * of any other kind: AVPlayer answered a file's refused ranges (401) with a dozen seconds of
 * retries and then a stall it never reported as an error, so the stall is the only word of it.
 */
export const STALL_REOPEN_MS = 10_000

export const SESSION_COPY = {
  exhausted: "This video didn't start in any of the ways the server offers.",
  noWay: "The server offers no way to play this video here, and won't convert it.",
} as const

export const SESSION_PHASES = {
  sourcing: 'sourcing',
  loading: 'loading',
  playing: 'playing',
  refused: 'refused',
  failed: 'failed',
} as const

export const SESSION_EVENTS = {
  sourced: 'sourced',
  loaded: 'loaded',
  failed: 'failed',
  dropped: 'dropped',
  timedOut: 'timedOut',
  audioPicked: 'audioPicked',
  burnPicked: 'burnPicked',
  retried: 'retried',
} as const

/** A source the server handed out: what the player loads and the headers it sends. */
type Sourced = Extract<SourceOutcome, { ok: true }>

/** Where the ladder stands: the plan's ways, the one tried now, and the spot it starts from. */
type Ladder = {
  modes: readonly PlaybackMode[]
  step: number
  at: number
  /** The audio track a stream carries; direct play switches to it itself. */
  audio: number | null
  /** Counts each source asked for, so what an earlier one says is not taken for this one. */
  attempt: number
  /** The plan's reasons a way is missing, shown once every way has failed. */
  problems: readonly string[]
  /** The spot this way was last opened again from, after the server let go of it; null before. */
  reopenedAt: number | null
  /** The picture subtitle a transcode burns into the picture, by track id; null for none. */
  burn: string | null
  /** The way played before a burn moved to the transcode, which clearing it goes back to. */
  stepBeforeBurn: number | null
}

export type SessionState =
  | (Ladder & { phase: typeof SESSION_PHASES.sourcing })
  | (Ladder & { phase: typeof SESSION_PHASES.loading; sourced: Sourced })
  | (Ladder & { phase: typeof SESSION_PHASES.playing; sourced: Sourced })
  | (Ladder & { phase: typeof SESSION_PHASES.refused; refusal: AccessRefusal })
  | { phase: typeof SESSION_PHASES.failed; problems: readonly string[] }

type SessionEvent =
  | { type: typeof SESSION_EVENTS.sourced; attempt: number; outcome: SourceOutcome }
  | { type: typeof SESSION_EVENTS.loaded; attempt: number }
  | { type: typeof SESSION_EVENTS.failed; attempt: number; at: number }
  | { type: typeof SESSION_EVENTS.dropped; attempt: number; at: number }
  | { type: typeof SESSION_EVENTS.timedOut; attempt: number }
  | { type: typeof SESSION_EVENTS.audioPicked; audio: number | null; at: number }
  | { type: typeof SESSION_EVENTS.burnPicked; burn: string | null; at: number }
  | { type: typeof SESSION_EVENTS.retried }

type FailedWithProps = {
  problems: readonly string[]
  fallback: string
}

/** Nothing to play: the plan's own reasons when it has any, else what the player can say. */
const failedWith = ({ problems, fallback }: FailedWithProps): SessionState => ({
  phase: SESSION_PHASES.failed,
  problems: problems.length > 0 ? problems : [fallback],
})

type InitialSessionProps = {
  modes: readonly PlaybackMode[]
  at: number
  audio: number | null
  problems: readonly string[]
}

/** Opens the ladder at the plan's first way, from `at`; a plan with none has failed already. */
export const initialSession = ({
  modes,
  at,
  audio,
  problems,
}: InitialSessionProps): SessionState =>
  modes.length === 0
    ? failedWith({ problems, fallback: SESSION_COPY.noWay })
    : {
        phase: SESSION_PHASES.sourcing,
        modes,
        step: 0,
        at,
        audio,
        attempt: 0,
        problems,
        reopenedAt: null,
        burn: null,
        stepBeforeBurn: null,
      }

/** The way being tried, or null once every way has failed. */
export const modeOf = (state: SessionState): PlaybackMode | null =>
  state.phase === SESSION_PHASES.failed ? null : (state.modes[state.step] ?? null)

const isStream = (mode: PlaybackMode | null): boolean =>
  mode === PLAYBACK_MODES.remux || mode === PLAYBACK_MODES.transcode

type SourcingProps = {
  ladder: Ladder
  step: number
  at: number
}

/** Asks for a source again, the same way or the next, from `at`. */
const sourcing = ({ ladder, step, at }: SourcingProps): SessionState => ({
  phase: SESSION_PHASES.sourcing,
  modes: ladder.modes,
  step,
  at,
  audio: ladder.audio,
  attempt: ladder.attempt + 1,
  problems: ladder.problems,
  reopenedAt: step === ladder.step ? ladder.reopenedAt : null,
  burn: ladder.burn,
  stepBeforeBurn: ladder.stepBeforeBurn,
})

type BurnPickedProps = { ladder: Ladder; burn: string | null; at: number }

/**
 * A picture subtitle picked to burn in, or a burn cleared, from `at`. Only a transcode re-encodes
 * the picture, so a burn moves to the plan's transcode, remembering the way it played before;
 * clearing it goes back to that way. A plan with no transcode (transcoding off) burns nothing.
 */
const burnPicked = ({ ladder, burn, at }: BurnPickedProps): Ladder | null => {
  if (burn === ladder.burn) return null
  if (burn === null) {
    return {
      ...ladder,
      burn: null,
      step: ladder.stepBeforeBurn ?? ladder.step,
      stepBeforeBurn: null,
    }
  }
  const transcode = ladder.modes.indexOf(PLAYBACK_MODES.transcode)
  if (transcode < 0) return null
  return {
    ...ladder,
    burn,
    step: transcode,
    stepBeforeBurn: ladder.burn === null ? ladder.step : ladder.stepBeforeBurn,
    at,
  }
}

type StepDownProps = { ladder: Ladder; at: number }

/**
 * The next way down from where `ladder` stands, from `at`. Once there is none, the player says
 * every way failed, then gives the plan's reasons for the ways it never offered, as the web does.
 */
const stepDown = ({ ladder, at }: StepDownProps): SessionState => {
  const step = ladder.step + 1
  if (step >= ladder.modes.length)
    return { phase: SESSION_PHASES.failed, problems: [SESSION_COPY.exhausted, ...ladder.problems] }
  return sourcing({ ladder, step, at })
}

type HasPlayedOnProps = { ladder: Ladder; at: number }

/**
 * Whether the way being played has played on since it was last opened again, so the server's
 * letting go of it is one more lapse of a long play (a file pass or an HLS session the server
 * ended or forgot) rather than a source that fails wherever it is opened.
 */
const hasPlayedOn = ({ ladder, at }: HasPlayedOnProps): boolean =>
  ladder.reopenedAt === null || at > ladder.reopenedAt

/**
 * Whether a way is left below the one tried now. Only then does a slow load step down: the last
 * way gets all the time it takes, as a transcode on a NAS may need longer than
 * `LOAD_TIMEOUT_MS` for its first segment, and the server waits for it up to its own limit.
 */
export const hasWayBelow = (state: SessionState): boolean =>
  state.phase !== SESSION_PHASES.failed && state.step < state.modes.length - 1

/**
 * The ladder, as the web's: the plan's first way, then the next whenever one fails to start or
 * to decode, or, while a way is left below, has not loaded within `LOAD_TIMEOUT_MS`, each from
 * the spot it got to. A remux the server refuses (its 409, keyframes too far apart to cut)
 * fails like any other, so the transcode below it is next. A source the server lets go of while
 * it plays (`dropped`: its file pass or its HLS session ended, forgotten or lost to a restart)
 * is opened again the same way from the spot, with a source handed out afresh, so a film longer
 * than a pass plays to its end; only a refusal of that source shows. One the server lets
 * go of before it loaded, or again before it played on from its reopening, fails as any other.
 */
export const sessionReducer = (state: SessionState, event: SessionEvent): SessionState => {
  if (state.phase === SESSION_PHASES.failed) return state
  switch (event.type) {
    case SESSION_EVENTS.sourced: {
      if (state.phase !== SESSION_PHASES.sourcing || event.attempt !== state.attempt) return state
      const { outcome } = event
      if (!outcome.ok) return { ...state, phase: SESSION_PHASES.refused, refusal: outcome }
      return { ...state, phase: SESSION_PHASES.loading, sourced: outcome }
    }
    case SESSION_EVENTS.loaded:
      if (state.phase !== SESSION_PHASES.loading || event.attempt !== state.attempt) return state
      return { ...state, phase: SESSION_PHASES.playing }
    case SESSION_EVENTS.failed:
      if (event.attempt !== state.attempt || state.phase === SESSION_PHASES.refused) return state
      return stepDown({ ladder: state, at: event.at })
    case SESSION_EVENTS.dropped:
      if (event.attempt !== state.attempt || state.phase === SESSION_PHASES.refused) return state
      if (state.phase !== SESSION_PHASES.playing || !hasPlayedOn({ ladder: state, at: event.at }))
        return stepDown({ ladder: state, at: event.at })
      return sourcing({
        ladder: { ...state, reopenedAt: event.at },
        step: state.step,
        at: event.at,
      })
    case SESSION_EVENTS.timedOut:
      if (
        state.phase !== SESSION_PHASES.loading ||
        event.attempt !== state.attempt ||
        !hasWayBelow(state)
      )
        return state
      return stepDown({ ladder: state, at: state.at })
    case SESSION_EVENTS.audioPicked: {
      const picked = { ...state, audio: event.audio }
      if (!isStream(modeOf(state))) return picked
      return sourcing({ ladder: picked, step: state.step, at: event.at })
    }
    case SESSION_EVENTS.burnPicked: {
      const moved = burnPicked({ ladder: state, burn: event.burn, at: event.at })
      if (moved === null) return state
      return sourcing({ ladder: { ...moved, step: state.step }, step: moved.step, at: event.at })
    }
    case SESSION_EVENTS.retried:
      if (state.phase !== SESSION_PHASES.refused) return state
      return sourcing({ ladder: state, step: state.step, at: state.at })
    default: {
      const unknown: never = event
      return unknown
    }
  }
}

/** The source the player loads, from when the session hands it over until it gives way. */
export const sourcedOf = (state: SessionState): Sourced | null =>
  state.phase === SESSION_PHASES.loading || state.phase === SESSION_PHASES.playing
    ? state.sourced
    : null

/**
 * The line shown in place of the video: why nothing plays, or the refusal; none while it opens,
 * which the chrome shows as raven's mark and a spinner (`isOpeningOf`), never in words;
 * null once frames flow.
 */
export const noticeOf = (state: SessionState): string | null => {
  switch (state.phase) {
    case SESSION_PHASES.failed:
      return state.problems.join('\n')
    case SESSION_PHASES.refused:
      return state.refusal.message
    case SESSION_PHASES.sourcing:
    case SESSION_PHASES.loading:
    case SESSION_PHASES.playing:
      return null
    default: {
      const unknown: never = state
      return unknown
    }
  }
}

/** Whether the video is still opening: its source asked for, or handed over and not yet loaded. */
export const isOpeningOf = (state: SessionState): boolean =>
  state.phase === SESSION_PHASES.sourcing || state.phase === SESSION_PHASES.loading

type UsePlaybackSessionProps = {
  media: Pick<MediaItem, 'id'>
  modes: readonly PlaybackMode[]
  at: number
  audio: number | null
  problems: readonly string[]
  sources: MediaSources
  /** Whether the player is waiting for data, as its buffering says. */
  isWaiting: boolean
  /** Where the video is, in seconds, as the screen draws it: a stall lasts only while it stands still. */
  clock: number
}

/**
 * Plays `media` down its plan's ladder: asks `sources` for each way's source in turn, steps
 * down when the player says one failed or it has not loaded in time, opens a direct play again
 * from its `clock` once it has waited for data (`isWaiting`) `STALL_REOPEN_MS` with the clock
 * standing still, and asks again
 * after a refusal once the server's cookies change, as an unlock changes them.
 */
export const usePlaybackSession = ({
  media,
  modes,
  at,
  audio,
  problems,
  sources,
  isWaiting,
  clock,
}: UsePlaybackSessionProps): { state: SessionState; dispatch: (event: SessionEvent) => void } => {
  const [state, dispatch] = useReducer(
    sessionReducer,
    { modes, at, audio, problems },
    initialSession,
  )
  const phase = state.phase
  const attempt = phase === SESSION_PHASES.failed ? null : state.attempt
  const isTimed = hasWayBelow(state)
  const isDirectStall =
    isWaiting && phase === SESSION_PHASES.playing && modeOf(state) === PLAYBACK_MODES.direct

  const ask = useEffectEvent((asked: number) => {
    const status = { isCurrent: true }
    const mode = modeOf(state)
    if (state.phase !== SESSION_PHASES.sourcing || mode === null) return () => undefined
    const { at: from } = state
    sources
      .source({
        media,
        mode,
        audio: state.audio,
        burn: mode === PLAYBACK_MODES.transcode ? state.burn : null,
      })
      .then(
        (outcome) => {
          if (status.isCurrent) dispatch({ type: SESSION_EVENTS.sourced, attempt: asked, outcome })
        },
        // `source` answers every request with an outcome; should one still reject, the next way is tried.
        () => {
          if (status.isCurrent) dispatch({ type: SESSION_EVENTS.failed, attempt: asked, at: from })
        },
      )
    return () => {
      status.isCurrent = false
    }
  })

  useEffect(() => {
    if (phase !== SESSION_PHASES.sourcing || attempt === null) return undefined
    return ask(attempt)
  }, [phase, attempt])

  useEffect(() => {
    if (phase !== SESSION_PHASES.loading || attempt === null || !isTimed) return undefined
    const timer = setTimeout(
      () => dispatch({ type: SESSION_EVENTS.timedOut, attempt }),
      LOAD_TIMEOUT_MS,
    )
    return () => clearTimeout(timer)
  }, [phase, attempt, isTimed])

  useEffect(() => {
    if (!isDirectStall || attempt === null) return undefined
    const timer = setTimeout(
      () => dispatch({ type: SESSION_EVENTS.dropped, attempt, at: clock }),
      STALL_REOPEN_MS,
    )
    return () => clearTimeout(timer)
  }, [isDirectStall, attempt, clock])

  useEffect(() => {
    if (phase !== SESSION_PHASES.refused) return undefined
    return useCookieVersion.subscribe(() => dispatch({ type: SESSION_EVENTS.retried }))
  }, [phase])

  return { state, dispatch }
}
