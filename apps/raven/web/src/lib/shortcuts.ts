/** Something the player does in answer to a key. */
export type PlayerAction =
  | { type: 'togglePlay' }
  | { type: 'seekBy'; seconds: number }
  | { type: 'seekToFraction'; fraction: number }
  | { type: 'seekToEdge'; edge: 'start' | 'end' }
  | { type: 'volumeBy'; delta: number }
  | { type: 'toggleMute' }
  | { type: 'toggleFullscreen' }
  | { type: 'toggleSubtitles' }
  | { type: 'stepFrame'; direction: 1 | -1 }
  | { type: 'stepSpeed'; direction: 1 | -1 }
  | { type: 'stepCaptionSize'; direction: 1 | -1 }
  | { type: 'showShortcuts' }
  | { type: 'escape' }

export type KeyPress = {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
}

const FIXED: Record<string, PlayerAction> = {
  k: { type: 'togglePlay' },
  ' ': { type: 'togglePlay' },
  j: { type: 'seekBy', seconds: -10 },
  l: { type: 'seekBy', seconds: 10 },
  ArrowLeft: { type: 'seekBy', seconds: -5 },
  ArrowRight: { type: 'seekBy', seconds: 5 },
  ArrowUp: { type: 'volumeBy', delta: 0.05 },
  ArrowDown: { type: 'volumeBy', delta: -0.05 },
  m: { type: 'toggleMute' },
  f: { type: 'toggleFullscreen' },
  c: { type: 'toggleSubtitles' },
  Home: { type: 'seekToEdge', edge: 'start' },
  End: { type: 'seekToEdge', edge: 'end' },
  ',': { type: 'stepFrame', direction: -1 },
  '.': { type: 'stepFrame', direction: 1 },
  '<': { type: 'stepSpeed', direction: -1 },
  '>': { type: 'stepSpeed', direction: 1 },
  '+': { type: 'stepCaptionSize', direction: 1 },
  '=': { type: 'stepCaptionSize', direction: 1 },
  '-': { type: 'stepCaptionSize', direction: -1 },
  _: { type: 'stepCaptionSize', direction: -1 },
  '?': { type: 'showShortcuts' },
  Escape: { type: 'escape' },
}

/**
 * YouTube's keyboard shortcuts, for a single video: what a key press asks
 * the player to do, or null when the key is not the player's. Letters
 * count whatever their case, so caps lock does not get in the way; with
 * Ctrl, Cmd or Alt held the key belongs to the browser.
 */
export const shortcutFor = ({ key, metaKey, ctrlKey, altKey }: KeyPress): PlayerAction | null => {
  if (metaKey || ctrlKey || altKey) return null
  if (/^[0-9]$/.test(key)) return { type: 'seekToFraction', fraction: Number(key) / 10 }
  const named = key.length === 1 ? key.toLowerCase() : key
  return FIXED[named] ?? null
}

/** The list the `?` dialog shows, in YouTube's order. */
export const SHORTCUT_LIST: ReadonlyArray<{ keys: string[]; action: string }> = [
  { keys: ['k', 'Space'], action: 'Play or pause' },
  { keys: ['j', 'l'], action: 'Back or forward 10 seconds' },
  { keys: ['←', '→'], action: 'Back or forward 5 seconds' },
  { keys: ['↑', '↓'], action: 'Volume up or down' },
  { keys: ['m'], action: 'Mute' },
  { keys: ['f'], action: 'Full screen' },
  { keys: ['c'], action: 'Subtitles on or off' },
  { keys: ['+', '-'], action: 'Bigger or smaller subtitles' },
  { keys: ['0', '9'], action: 'Jump to 0% to 90%' },
  { keys: ['Home', 'End'], action: 'Start or end' },
  { keys: [',', '.'], action: 'Pause, then one frame back or forward' },
  { keys: ['<', '>'], action: 'Slower or faster' },
  { keys: ['?'], action: 'These shortcuts' },
  { keys: ['Esc'], action: 'Close, leave full screen, or back to the library' },
]

export const SPEEDS: readonly number[] = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]

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

export const CAPTION_SCALES: readonly number[] = [0.75, 1, 1.25, 1.5, 1.75, 2]

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
