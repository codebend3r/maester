import type { PlayerErrorReason } from '@raven/core'
import { MPV_END_FILE_REASONS } from '@raven/mpv'
import { PLAYER_PHASES, type ShowingPhase } from '@/main/player/phases'

/** How long before its end a file may stop and still count as having played through. */
export const EOF_SHORT_S = 5

/** A failure the page hears: why, and the words it shows. */
export type Failure = { reason: PlayerErrorReason; message: string }

/** What a file's end comes to for the title on screen. */
export const ENDINGS = {
  /** Nothing: the title goes on as it was. */
  stays: 'stays',
  /** The relay saw the server refuse the account. */
  refused: 'refused',
  /** The file never opened. */
  cannotOpen: 'cannotOpen',
  /** The file stopped short of its end. */
  stopped: 'stopped',
  /** The file played to its end. */
  ended: 'ended',
  /** mpv quit: the title is over, with nothing to tell. */
  quit: 'quit',
} as const

export type Ending =
  | { kind: typeof ENDINGS.stays }
  | { kind: typeof ENDINGS.refused; failure: Failure }
  | { kind: typeof ENDINGS.cannotOpen }
  | { kind: typeof ENDINGS.stopped }
  | { kind: typeof ENDINGS.ended }
  | { kind: typeof ENDINGS.quit }

/** The reasons an end-file is read for; a redirect is a playlist, which ends the title its own way. */
export type EndReason = Exclude<
  (typeof MPV_END_FILE_REASONS)[keyof typeof MPV_END_FILE_REASONS],
  typeof MPV_END_FILE_REASONS.redirect
>

/**
 * What the service knows as a file ends: the account refusal the relay saw, which is read for an
 * eof alone, since mpv ends a stream the server refused as if it ran out, and whether a loaded
 * file stopped more than `EOF_SHORT_S` short of its end.
 */
type EndFacts = { refused: Failure | null; isShort: boolean }

const STAYS: Ending = { kind: ENDINGS.stays }
const CANNOT_OPEN: Ending = { kind: ENDINGS.cannotOpen }
const STOPPED: Ending = { kind: ENDINGS.stopped }
const ENDED: Ending = { kind: ENDINGS.ended }
const QUIT: Ending = { kind: ENDINGS.quit }

const refusedBy = (failure: Failure): Ending => ({ kind: ENDINGS.refused, failure })

const loadedEof = ({ refused, isShort }: EndFacts): Ending => {
  if (refused !== null) return refusedBy(refused)
  // A seek near the end that the server refused runs out like the end itself.
  return isShort ? STOPPED : ENDED
}

/*
 * By the phase the title was in and why mpv ended the file. mpv reports `stop` for a file
 * replaced by a load or ended by our own stop, which belongs to a file the service already left.
 * An eof while a title opens is only the end of a stream the server refused.
 */
const ENDING_RULES = {
  [PLAYER_PHASES.loading]: {
    [MPV_END_FILE_REASONS.eof]: ({ refused }: EndFacts) =>
      refused === null ? STAYS : refusedBy(refused),
    [MPV_END_FILE_REASONS.error]: () => CANNOT_OPEN,
    [MPV_END_FILE_REASONS.quit]: () => QUIT,
    [MPV_END_FILE_REASONS.stop]: () => STAYS,
  },
  [PLAYER_PHASES.loaded]: {
    [MPV_END_FILE_REASONS.eof]: loadedEof,
    [MPV_END_FILE_REASONS.error]: () => STOPPED,
    [MPV_END_FILE_REASONS.quit]: () => QUIT,
    [MPV_END_FILE_REASONS.stop]: () => STAYS,
  },
} as const satisfies Record<ShowingPhase, Record<EndReason, (facts: EndFacts) => Ending>>

type EndingOfProps = { phase: ShowingPhase; reason: EndReason; facts: EndFacts }

export const endingOf = ({ phase, reason, facts }: EndingOfProps): Ending =>
  ENDING_RULES[phase][reason](facts)
