import { KEYS } from '@/keys'

export const PLAYER_ACTIONS = {
  togglePlay: 'togglePlay',
  skip: 'skip',
  seekToFraction: 'seekToFraction',
  seekToEdge: 'seekToEdge',
  volumeBy: 'volumeBy',
  toggleMute: 'toggleMute',
  toggleFullscreen: 'toggleFullscreen',
  toggleSubtitles: 'toggleSubtitles',
  stepFrame: 'stepFrame',
  stepSpeed: 'stepSpeed',
  stepCaptionSize: 'stepCaptionSize',
  toggleStats: 'toggleStats',
  showShortcuts: 'showShortcuts',
  escape: 'escape',
} as const

/** Where Home and End seek to. */
export const SEEK_EDGES = { start: 'start', end: 'end' } as const

type SeekEdge = (typeof SEEK_EDGES)[keyof typeof SEEK_EDGES]

/** Something the player does in answer to a key. */
export type PlayerAction =
  | { type: typeof PLAYER_ACTIONS.togglePlay }
  | { type: typeof PLAYER_ACTIONS.skip; direction: 1 | -1 }
  | { type: typeof PLAYER_ACTIONS.seekToFraction; fraction: number }
  | { type: typeof PLAYER_ACTIONS.seekToEdge; edge: SeekEdge }
  | { type: typeof PLAYER_ACTIONS.volumeBy; delta: number }
  | { type: typeof PLAYER_ACTIONS.toggleMute }
  | { type: typeof PLAYER_ACTIONS.toggleFullscreen }
  | { type: typeof PLAYER_ACTIONS.toggleSubtitles }
  | { type: typeof PLAYER_ACTIONS.stepFrame; direction: 1 | -1 }
  | { type: typeof PLAYER_ACTIONS.stepSpeed; direction: 1 | -1 }
  | { type: typeof PLAYER_ACTIONS.stepCaptionSize; direction: 1 | -1 }
  | { type: typeof PLAYER_ACTIONS.toggleStats }
  | { type: typeof PLAYER_ACTIONS.showShortcuts }
  | { type: typeof PLAYER_ACTIONS.escape }

export type KeyPress = {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
}

const FIXED: Record<string, PlayerAction> = {
  k: { type: PLAYER_ACTIONS.togglePlay },
  [KEYS.space]: { type: PLAYER_ACTIONS.togglePlay },
  j: { type: PLAYER_ACTIONS.skip, direction: -1 },
  l: { type: PLAYER_ACTIONS.skip, direction: 1 },
  [KEYS.arrowLeft]: { type: PLAYER_ACTIONS.skip, direction: -1 },
  [KEYS.arrowRight]: { type: PLAYER_ACTIONS.skip, direction: 1 },
  [KEYS.arrowUp]: { type: PLAYER_ACTIONS.volumeBy, delta: 0.05 },
  [KEYS.arrowDown]: { type: PLAYER_ACTIONS.volumeBy, delta: -0.05 },
  m: { type: PLAYER_ACTIONS.toggleMute },
  f: { type: PLAYER_ACTIONS.toggleFullscreen },
  c: { type: PLAYER_ACTIONS.toggleSubtitles },
  i: { type: PLAYER_ACTIONS.toggleStats },
  Home: { type: PLAYER_ACTIONS.seekToEdge, edge: SEEK_EDGES.start },
  End: { type: PLAYER_ACTIONS.seekToEdge, edge: SEEK_EDGES.end },
  ',': { type: PLAYER_ACTIONS.stepFrame, direction: -1 },
  '.': { type: PLAYER_ACTIONS.stepFrame, direction: 1 },
  '<': { type: PLAYER_ACTIONS.stepSpeed, direction: -1 },
  '>': { type: PLAYER_ACTIONS.stepSpeed, direction: 1 },
  '+': { type: PLAYER_ACTIONS.stepCaptionSize, direction: 1 },
  '=': { type: PLAYER_ACTIONS.stepCaptionSize, direction: 1 },
  '-': { type: PLAYER_ACTIONS.stepCaptionSize, direction: -1 },
  _: { type: PLAYER_ACTIONS.stepCaptionSize, direction: -1 },
  '?': { type: PLAYER_ACTIONS.showShortcuts },
  [KEYS.escape]: { type: PLAYER_ACTIONS.escape },
}

/**
 * YouTube's keyboard shortcuts, for a single video: what a key press asks
 * the player to do, or null when the key is not the player's. Letters
 * count whatever their case, so caps lock does not get in the way; with
 * Ctrl, Cmd or Alt held the key belongs to the browser.
 */
export const shortcutFor = ({ key, metaKey, ctrlKey, altKey }: KeyPress): PlayerAction | null => {
  if (metaKey || ctrlKey || altKey) return null
  if (/^[0-9]$/.test(key))
    return { type: PLAYER_ACTIONS.seekToFraction, fraction: Number(key) / 10 }
  const named = key.length === 1 ? key.toLowerCase() : key
  return FIXED[named] ?? null
}

type ShortcutRow = {
  keys: readonly string[]
  action: string
  /** Listed only by a player whose engine has the video info overlay. */
  isStats?: boolean
}

/** Every row the `?` dialog can show, in YouTube's order. */
const SHORTCUT_ROWS: readonly ShortcutRow[] = [
  { keys: ['k', 'Space'], action: 'Play or pause' },
  {
    keys: ['j', 'l', '←', '→'],
    action: 'Back or forward 10 seconds, up to 30 when pressed quickly',
  },
  { keys: ['↑', '↓'], action: 'Volume up or down' },
  { keys: ['m'], action: 'Mute' },
  { keys: ['f'], action: 'Full screen' },
  { keys: ['c'], action: 'Subtitles on or off' },
  { keys: ['+', '-'], action: 'Bigger or smaller subtitles' },
  { keys: ['0', '9'], action: 'Jump to 0% to 90%' },
  { keys: ['Home', 'End'], action: 'Start or end' },
  { keys: [',', '.'], action: 'Pause, then one frame back or forward' },
  { keys: ['<', '>'], action: 'Slower or faster' },
  { keys: ['i'], action: 'Video info', isStats: true },
  { keys: ['?'], action: 'These shortcuts' },
  { keys: ['Esc'], action: 'Close, leave full screen, or back to the library' },
]

/** The rows the `?` dialog shows for a player that can or cannot show video info. */
export const shortcutRows = ({ canShowStats }: { canShowStats: boolean }): readonly ShortcutRow[] =>
  SHORTCUT_ROWS.filter((row) => canShowStats || row.isStats !== true)

export const SPEEDS: readonly number[] = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 3.5, 4]

/** The next speed up or down the ladder from `current`, staying on it at the ends. */
export const stepSpeed = ({
  current,
  direction,
}: {
  current: number
  direction: 1 | -1
}): number => {
  const index = SPEEDS.findIndex((speed) => speed >= current - 0.001)
  const from = index < 0 ? SPEEDS.length - 1 : index
  const exact = SPEEDS[from] === current
  const next = direction > 0 ? (exact ? from + 1 : from) : from - 1
  return SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, next))] ?? current
}

/** How far the first skip goes, and how much further each quick press after it goes. */
const SKIP_SECONDS = 10

/** The furthest one skip goes. */
const SKIP_MAX_SECONDS = 30

/** A press this soon after the last one in the same direction goes a step further. */
const SKIP_WINDOW_MS = 1_000

/** One skip: which way, how far, and when it was pressed, in milliseconds. */
export type SkipStep = { direction: 1 | -1; seconds: number; at: number }

/**
 * How far a skip pressed at `at` goes: 10 seconds, or a step up the ladder
 * to 20 and then 30 when it comes within a second of the last skip the same
 * way. A slower press, or one the other way, starts again at 10.
 */
export const stepSkip = ({
  last,
  direction,
  at,
}: {
  last: SkipStep | null
  direction: 1 | -1
  at: number
}): SkipStep => {
  const isQuick = last != null && last.direction === direction && at - last.at < SKIP_WINDOW_MS
  const seconds = isQuick ? Math.min(last.seconds + SKIP_SECONDS, SKIP_MAX_SECONDS) : SKIP_SECONDS
  return { direction, seconds, at }
}

const CAPTION_SCALES: readonly number[] = [0.75, 1, 1.25, 1.5, 1.75, 2]

export const stepCaptionScale = ({
  current,
  direction,
}: {
  current: number
  direction: 1 | -1
}): number => {
  const index = CAPTION_SCALES.findIndex((scale) => scale >= current - 0.001)
  const from = index < 0 ? CAPTION_SCALES.length - 1 : index
  const next = Math.max(0, Math.min(CAPTION_SCALES.length - 1, from + direction))
  return CAPTION_SCALES[next] ?? current
}
