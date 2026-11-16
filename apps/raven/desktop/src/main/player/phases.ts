/** Where a title is in its life: `dead` once mpv stopped for good. */
export const PLAYER_PHASES = {
  idle: 'idle',
  loading: 'loading',
  loaded: 'loaded',
  dead: 'dead',
} as const

/** The phases in which the page shows a title. */
export type ShowingPhase = typeof PLAYER_PHASES.loading | typeof PLAYER_PHASES.loaded
