import { type Infer, isNumber, isString, listOf, nullable, object, oneOf } from '@raven/core'

export const RECENTS_CAP = 50
export const RESUME_CAP = 1000
export const TRACKS_CAP = 1000
export const END_MARGIN_S = 10

export const isRecentEntry = object({
  kind: oneOf(['file']),
  path: isString,
  openedAt: isNumber,
})

export const isResumeEntry = object({
  path: isString,
  size: isNumber,
  mtimeMs: isNumber,
  position: isNumber,
  duration: nullable(isNumber),
  playedAt: isNumber,
})

export const isTrackPick = object({
  path: isString,
  audio: nullable(isNumber),
  subtitle: nullable(isString),
  pickedAt: isNumber,
})

export const isWindowBounds = object({
  x: isNumber,
  y: isNumber,
  width: isNumber,
  height: isNumber,
  displayId: isNumber,
})

export const isPlayerState = object({
  version: oneOf([1]),
  recents: listOf(isRecentEntry),
  resume: listOf(isResumeEntry),
  tracks: listOf(isTrackPick),
  window: nullable(isWindowBounds),
})

export type RecentEntry = Infer<typeof isRecentEntry>
export type ResumeEntry = Infer<typeof isResumeEntry>
export type TrackPick = Infer<typeof isTrackPick>
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

export const addRecent = (
  state: PlayerState,
  { path, at }: { path: string; at: number },
): PlayerState => ({
  ...state,
  recents: upsertFirst({
    list: state.recents,
    entry: { kind: 'file', path, openedAt: at } satisfies RecentEntry,
    cap: RECENTS_CAP,
  }),
})

export const removeRecent = (state: PlayerState, { path }: { path: string }): PlayerState => ({
  ...state,
  recents: state.recents.filter((entry) => entry.path !== path),
})

export const clearRecents = (state: PlayerState): PlayerState => ({ ...state, recents: [] })

const isFinished = ({
  position,
  duration,
}: {
  position: number
  duration: number | null
}): boolean => position <= 0 || (duration !== null && position >= duration - END_MARGIN_S)

/** The saved entry for this file as it is now: a replaced file (other size or mtime) has none. */
const savedFor = (state: PlayerState, { file }: { file: FileFacts }): ResumeEntry | null => {
  const saved = state.resume.find((entry) => entry.path === file.path)
  if (!saved) return null
  if (saved.size !== file.size || saved.mtimeMs !== file.mtimeMs) return null
  return saved
}

export const savePosition = (
  state: PlayerState,
  {
    file,
    position,
    duration: reported,
    at,
  }: { file: FileFacts; position: number; duration: number | null; at: number },
): PlayerState => {
  // A player that leaves before it learns the length reports none; the length known before still holds.
  const duration = reported ?? savedFor(state, { file })?.duration ?? null
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

export const resumeFor = (state: PlayerState, { file }: { file: FileFacts }): number => {
  const saved = savedFor(state, { file })
  if (!saved) return 0
  return isFinished(saved) ? 0 : saved.position
}

export const watchedShare = (state: PlayerState, { file }: { file: FileFacts }): number | null => {
  const saved = savedFor(state, { file })
  if (!saved || saved.duration === null || saved.duration <= 0) return null
  return Math.min(1, Math.max(0, saved.position / saved.duration))
}

export const setTrackPick = (
  state: PlayerState,
  {
    path,
    audio,
    subtitle,
    at,
  }: { path: string; audio: number | null; subtitle: string | null; at: number },
): PlayerState => ({
  ...state,
  tracks: upsertFirst({
    list: state.tracks,
    entry: { path, audio, subtitle, pickedAt: at },
    cap: TRACKS_CAP,
  }),
})

export const trackPickFor = (
  state: PlayerState,
  { path }: { path: string },
): { audio: number | null; subtitle: string | null } | null => {
  const pick = state.tracks.find((entry) => entry.path === path)
  if (!pick) return null
  return { audio: pick.audio, subtitle: pick.subtitle }
}

export const setWindowBounds = (
  state: PlayerState,
  { bounds }: { bounds: WindowBounds },
): PlayerState => ({ ...state, window: bounds })
