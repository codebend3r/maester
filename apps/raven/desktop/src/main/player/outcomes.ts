import { PLAYER_REFUSAL_REASONS, type PlayerRefusalReason } from '@raven/core'
import { PLAYER_MESSAGES } from '@/main/player/playerMessages'

/** What a command came to: done, or refused with the words the page shows. */
export type PlayerOutcome =
  | { ok: true }
  | { ok: false; reason: PlayerRefusalReason; message: string }

export const OK: PlayerOutcome = { ok: true }

export const refuse = (message: string): PlayerOutcome => ({
  ok: false,
  reason: PLAYER_REFUSAL_REASONS.refused,
  message,
})

/** The engine stopped for good: the page falls back, where it can. */
export const ENGINE_GONE: PlayerOutcome = {
  ok: false,
  reason: PLAYER_REFUSAL_REASONS.engine,
  message: PLAYER_MESSAGES.engineStopped,
}
