import { type Infer, isNumber, isString, listOf, nullable, object, oneOf, union } from '@raven/core'

export const RECENTS_CAP = 50
export const RESUME_CAP = 1000
export const TRACKS_CAP = 1000
export const END_MARGIN_S = 10

export const RECENT_KINDS = { file: 'file' } as const

/** The kinds of recent an older raven player kept besides: server titles, before the web app. */
export const FORMER_RECENT_KINDS = { server: 'server' } as const

const isRecentEntry = object({
  kind: oneOf([RECENT_KINDS.file]),
  path: isString,
  openedAt: isNumber,
})

/**
 * A server title in an older raven player's recents. It is read only to be dropped: the web app's
 * own lists show what was watched on the server now.
 */
const isFormerRecent = object({ kind: oneOf([FORMER_RECENT_KINDS.server]) })

const isResumeEntry = object({
  path: isString,
  size: isNumber,
  mtimeMs: isNumber,
  position: isNumber,
  duration: nullable(isNumber),
  playedAt: isNumber,
})

const isTrackPick = object({
  path: isString,
  audio: nullable(isNumber),
  subtitle: nullable(isString),
  pickedAt: isNumber,
})

const isWindowBounds = object({
  x: isNumber,
  y: isNumber,
  width: isNumber,
  height: isNumber,
  displayId: isNumber,
})

const STATE_FIELDS = {
  version: oneOf([1]),
  resume: listOf(isResumeEntry),
  tracks: listOf(isTrackPick),
  window: nullable(isWindowBounds),
}

const isPlayerState = object({ ...STATE_FIELDS, recents: listOf(isRecentEntry) })

/** What `player-state.json` may hold: this, or an older raven player's, whose recents held server titles too. */
export const isStoredPlayerState = object({
  ...STATE_FIELDS,
  recents: listOf(union(isRecentEntry, isFormerRecent)),
})

export type RecentEntry = Infer<typeof isRecentEntry>
type ResumeEntry = Infer<typeof isResumeEntry>
export type WindowBounds = Infer<typeof isWindowBounds>
export type PlayerState = Infer<typeof isPlayerState>

export type FileFacts = { path: string; size: number; mtimeMs: number }

export const EMPTY_STATE: PlayerState = {
  version: 1,
  recents: [],
  resume: [],
  tracks: [],
  window: null,
}

const upsertFirst = <T extends { path: string }>({
  list,
  entry,
  cap,
}: {
  list: readonly T[]
  entry: T
  cap: number
}): T[] => [entry, ...list.filter((existing) => existing.path !== entry.path)].slice(0, cap)

/** The state as this raven player keeps it: an older one's server titles leave the recents. */
export const upgradeState = (stored: Infer<typeof isStoredPlayerState>): PlayerState => ({
  ...stored,
  recents: stored.recents.filter(isRecentEntry),
})

/** One key per recent: a file by its path. */
export const recentKey = (entry: RecentEntry): string => `${entry.kind}:${entry.path}`

/** Puts `entry` first, dropping any older entry with its key, and keeps the newest `RECENTS_CAP`. */
const withRecent = ({ state, entry }: { state: PlayerState; entry: RecentEntry }): PlayerState => {
  const key = recentKey(entry)
  return {
    ...state,
    recents: [entry, ...state.recents.filter((existing) => recentKey(existing) !== key)].slice(
      0,
      RECENTS_CAP,
    ),
  }
}

export const addRecent = ({
  state,
  path,
  at,
}: {
  state: PlayerState
  path: string
  at: number
}): PlayerState => withRecent({ state, entry: { kind: RECENT_KINDS.file, path, openedAt: at } })

export const removeRecentByKey = ({
  state,
  key,
}: {
  state: PlayerState
  key: string
}): PlayerState => ({
  ...state,
  recents: state.recents.filter((entry) => recentKey(entry) !== key),
})

export const removeRecent = ({ state, path }: { state: PlayerState; path: string }): PlayerState =>
  removeRecentByKey({ state, key: recentKey({ kind: RECENT_KINDS.file, path, openedAt: 0 }) })

export const clearRecents = (state: PlayerState): PlayerState => ({ ...state, recents: [] })

const isFinished = ({
  position,
  duration,
}: {
  position: number
  duration: number | null
}): boolean => position <= 0 || (duration !== null && position >= duration - END_MARGIN_S)

/** The saved entry for this file as it is now: a replaced file (other size or mtime) has none. */
const savedFor = ({ state, file }: { state: PlayerState; file: FileFacts }): ResumeEntry | null => {
  const saved = state.resume.find((entry) => entry.path === file.path)
  if (!saved) return null
  if (saved.size !== file.size || saved.mtimeMs !== file.mtimeMs) return null
  return saved
}

export const savePosition = ({
  state,
  file,
  position,
  duration: reported,
  at,
}: {
  state: PlayerState
  file: FileFacts
  position: number
  duration: number | null
  at: number
}): PlayerState => {
  // A player that leaves before it learns the length reports none; the length known before still holds.
  const duration = reported ?? savedFor({ state, file })?.duration ?? null
  if (isFinished({ position, duration })) {
    return { ...state, resume: state.resume.filter((entry) => entry.path !== file.path) }
  }
  return {
    ...state,
    resume: upsertFirst({
      list: state.resume,
      entry: { ...file, position, duration, playedAt: at },
      cap: RESUME_CAP,
    }),
  }
}

/** Drops the path's resume spot; with none, the same state, so the store writes nothing. */
export const forgetResume = ({ state, path }: { state: PlayerState; path: string }): PlayerState =>
  state.resume.some((entry) => entry.path === path)
    ? { ...state, resume: state.resume.filter((entry) => entry.path !== path) }
    : state

/** Where the file starts: its saved spot, or `fallback` when it has none (a download's server spot). */
export const resumeFor = ({
  state,
  file,
  fallback = 0,
}: {
  state: PlayerState
  file: FileFacts
  fallback?: number
}): number => {
  const saved = savedFor({ state, file })
  if (!saved) return fallback
  return isFinished(saved) ? 0 : saved.position
}

export const watchedShare = ({
  state,
  file,
}: {
  state: PlayerState
  file: FileFacts
}): number | null => {
  const saved = savedFor({ state, file })
  if (!saved || saved.duration === null || saved.duration <= 0) return null
  return Math.min(1, Math.max(0, saved.position / saved.duration))
}

export const setTrackPick = ({
  state,
  path,
  audio,
  subtitle,
  at,
}: {
  state: PlayerState
  path: string
  audio: number | null
  subtitle: string | null
  at: number
}): PlayerState => ({
  ...state,
  tracks: upsertFirst({
    list: state.tracks,
    entry: { path, audio, subtitle, pickedAt: at },
    cap: TRACKS_CAP,
  }),
})

export const trackPickFor = ({
  state,
  path,
}: {
  state: PlayerState
  path: string
}): { audio: number | null; subtitle: string | null } | null => {
  const pick = state.tracks.find((entry) => entry.path === path)
  if (!pick) return null
  return { audio: pick.audio, subtitle: pick.subtitle }
}

export const setWindowBounds = ({
  state,
  bounds,
}: {
  state: PlayerState
  bounds: WindowBounds
}): PlayerState => ({ ...state, window: bounds })
