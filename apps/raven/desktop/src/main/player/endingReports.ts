import {
  PLAYER_ERROR_REASONS,
  PLAYER_EVENTS,
  PLAYER_SOURCE_KINDS,
  type PlayerEvent,
} from '@raven/core'
import { type EndReason, type Ending, ENDINGS, type Failure } from '@/main/player/endings'
import type { FailureExplainer, LoadTarget } from '@/main/player/loadTarget'
import { PLAYER_PHASES, type ShowingPhase } from '@/main/player/phases'
import { PLAYER_MESSAGES } from '@/main/player/playerMessages'
import { messageOf } from '@/shared/messageOf'

/** What a server title's failure says when the server cannot say why. */
export const LOST: Failure = { reason: PLAYER_ERROR_REASONS.network, message: PLAYER_MESSAGES.lost }

/** Why a title's account refusal is warned, by whether it was opening or playing. */
const REFUSED_WARNINGS = {
  [PLAYER_PHASES.loading]: 'mpv ended a server title its account was refused while it opened',
  [PLAYER_PHASES.loaded]: 'mpv ended a server title its account was refused while it played',
} as const satisfies Record<ShowingPhase, string>

type CreateEndingReportsProps = {
  emit: (event: PlayerEvent) => void
  warn: (message: string) => void
  explain: FailureExplainer
  /** The service's epoch, so an explanation that answers after something newer is dropped. */
  epoch: () => number
}

type EmitFailureProps = { failure: Failure; during: ShowingPhase; target: LoadTarget }

export type FinishProps = {
  ending: Exclude<Ending, { kind: typeof ENDINGS.stays }>
  during: ShowingPhase
  target: LoadTarget
  reason: EndReason
  error: number
}

/** What a title's end tells the page and the log. */
export const createEndingReports = ({ emit, warn, explain, epoch }: CreateEndingReportsProps) => {
  /**
   * An error the page hears: as it is for a file, or as the server explains it for a server
   * title, unless something newer overtook the ending while the server answered.
   */
  const emitFailure = ({ failure, during, target }: EmitFailureProps) => {
    if (target.kind !== PLAYER_SOURCE_KINDS.server) {
      emit({ type: PLAYER_EVENTS.error, ...failure })
      return
    }
    const token = epoch()
    const explainSafely = async (): Promise<Failure> => {
      try {
        return await explain({ target, phase: during })
      } catch (error) {
        warn(`player could not explain a server failure: ${messageOf(error)}`)
        return LOST
      }
    }
    const report = async () => {
      const explained = await explainSafely()
      if (token !== epoch()) return
      emit({ type: PLAYER_EVENTS.error, reason: explained.reason, message: explained.message })
    }
    report().catch((error: unknown) => {
      warn(`player could not report a server failure: ${messageOf(error)}`)
    })
  }

  /** What an ending tells the page and the log, once the title is back to idle. */
  const finish = ({ ending, during, target, reason, error }: FinishProps) => {
    switch (ending.kind) {
      case ENDINGS.refused:
        warn(REFUSED_WARNINGS[during])
        emitFailure({ failure: ending.failure, during, target })
        return
      case ENDINGS.cannotOpen:
        warn(`mpv could not open the file (${error})`)
        emitFailure({
          failure: { reason: PLAYER_ERROR_REASONS.open, message: PLAYER_MESSAGES.cannotOpen },
          during,
          target,
        })
        return
      case ENDINGS.stopped:
        warn(`mpv stopped playing the file (${reason} ${error})`)
        emitFailure({
          failure: { reason: PLAYER_ERROR_REASONS.decode, message: PLAYER_MESSAGES.stopped },
          during,
          target,
        })
        return
      case ENDINGS.ended:
        emit({ type: PLAYER_EVENTS.ended })
        return
      case ENDINGS.quit:
        return
      default: {
        const unreachable: never = ending
        return unreachable
      }
    }
  }

  return { finish }
}
