import { type Infer, isNumber, isString, listOf, nullable, object, oneOf } from '@raven/core'

export const RESUME_CAP = 1000
export const TRACKS_CAP = 1000
export const END_MARGIN_S = 10

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

/** What `player-state.json` holds. An older Raven's also listed the files it had opened, as `recents`. */
export const isPlayerState = object({
  version: oneOf([1]),
  resume: listOf(isResumeEntry),
  tracks: listOf(isTrackPick),
  window: nullable(isWindowBounds),
})

type ResumeEntry = Infer<typeof isResumeEntry>
export type WindowBounds = Infer<typeof isWindowBounds>
export type PlayerState = Infer<typeof isPlayerState>

export type FileFacts = { path: string; size: number; mtimeMs: number }

type ReadFactsProps = {
  stat: (path: string) => Promise<{ size: number; mtimeMs: number }>
  path: string
}

/** The file as the state keys it, or null when it cannot be read. */
export const readFacts = ({ stat, path }: ReadFactsProps): Promise<FileFacts | null> =>
  stat(path).then(
    ({ size, mtimeMs }): FileFacts | null => ({ path, size, mtimeMs }),
    () => null,
  )

export const EMPTY_STATE: PlayerState = {
  version: 1,
  resume: [],
  tracks: [],
  window: null,
}

type UpsertFirstProps<T extends { path: string }> = {
  list: readonly T[]
  entry: T
  cap: number
}

const upsertFirst = <T extends { path: string }>({ list, entry, cap }: UpsertFirstProps<T>): T[] =>
  [entry, ...list.filter((existing) => existing.path !== entry.path)].slice(0, cap)

/** The state as this Raven keeps it: whatever else an older one stored, its recents among it, is left behind. */
export const upgradeState = ({ version, resume, tracks, window }: PlayerState): PlayerState => ({
  version,
  resume,
  tracks,
  window,
})

type IsFinishedProps = {
  position: number
  duration: number | null
}

const isFinished = ({ position, duration }: IsFinishedProps): boolean =>
  position <= 0 || (duration !== null && position >= duration - END_MARGIN_S)

type SavedForProps = { state: PlayerState; file: FileFacts }

/** The saved entry for this file as it is now: a replaced file (other size or mtime) has none. */
const savedFor = ({ state, file }: SavedForProps): ResumeEntry | null => {
  const saved = state.resume.find((entry) => entry.path === file.path)
  if (!saved) return null
  if (saved.size !== file.size || saved.mtimeMs !== file.mtimeMs) return null
  return saved
}

type SavePositionProps = {
  state: PlayerState
  file: FileFacts
  position: number
  duration: number | null
  at: number
}

export const savePosition = ({
  state,
  file,
  position,
  duration: reported,
  at,
}: SavePositionProps): PlayerState => {
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

type ForgetResumeProps = { state: PlayerState; path: string }

/** Drops the path's resume spot; with none, the same state, so the store writes nothing. */
export const forgetResume = ({ state, path }: ForgetResumeProps): PlayerState =>
  state.resume.some((entry) => entry.path === path)
    ? { ...state, resume: state.resume.filter((entry) => entry.path !== path) }
    : state

type ResumeForProps = {
  state: PlayerState
  file: FileFacts
  fallback?: number
}

/** Where the file starts: its saved spot, or `fallback` when it has none (a download's server spot). */
export const resumeFor = ({ state, file, fallback = 0 }: ResumeForProps): number => {
  const saved = savedFor({ state, file })
  if (!saved) return fallback
  return isFinished(saved) ? 0 : saved.position
}

type WatchedShareProps = {
  state: PlayerState
  file: FileFacts
}

export const watchedShare = ({ state, file }: WatchedShareProps): number | null => {
  const saved = savedFor({ state, file })
  if (!saved || saved.duration === null || saved.duration <= 0) return null
  return Math.min(1, Math.max(0, saved.position / saved.duration))
}

type SetTrackPickProps = {
  state: PlayerState
  path: string
  audio: number | null
  subtitle: string | null
  at: number
}

export const setTrackPick = ({
  state,
  path,
  audio,
  subtitle,
  at,
}: SetTrackPickProps): PlayerState => ({
  ...state,
  tracks: upsertFirst({
    list: state.tracks,
    entry: { path, audio, subtitle, pickedAt: at },
    cap: TRACKS_CAP,
  }),
})

type TrackPickForProps = {
  state: PlayerState
  path: string
}

export const trackPickFor = ({
  state,
  path,
}: TrackPickForProps): { audio: number | null; subtitle: string | null } | null => {
  const pick = state.tracks.find((entry) => entry.path === path)
  if (!pick) return null
  return { audio: pick.audio, subtitle: pick.subtitle }
}

type SetWindowBoundsProps = {
  state: PlayerState
  bounds: WindowBounds
}

export const setWindowBounds = ({ state, bounds }: SetWindowBoundsProps): PlayerState => ({
  ...state,
  window: bounds,
})
