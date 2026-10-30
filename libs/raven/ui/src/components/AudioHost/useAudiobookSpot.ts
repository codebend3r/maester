import { type ApiClient, KIND_RULES, type Library, type Track, resumeAtFor } from '@raven/core'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import type { WatchHide } from '@/components/Player/useProgressReport'
import type { VideoState } from '@/components/Player/videoState'
import { progressStepOf } from '@/components/Player/watchProgress'
import { type ProgressSaver, createProgressSaver } from '@/lib/progressSaver'
import { afterWatching } from '@/query/invalidate'
import { ravenQueriesFor } from '@/query/ravenQueries'
import { AUDIO_STATES, type AudioState, useAudioQueue } from '@/stores/audioQueue'

const TRACK_SPOTS = { waiting: 'waiting', none: 'none', saved: 'saved' } as const

/**
 * Where the playing track starts, and whether its spot is saved: still being read, from its top
 * with nothing saved (music), or from where it was left with each spot saved (an audiobook).
 */
export type TrackSpot =
  | { kind: typeof TRACK_SPOTS.waiting }
  | { kind: typeof TRACK_SPOTS.none }
  | { kind: typeof TRACK_SPOTS.saved; at: number }

const WAITING = { kind: TRACK_SPOTS.waiting } as const satisfies TrackSpot
const NONE = { kind: TRACK_SPOTS.none } as const satisfies TrackSpot

/** Where a host starts the playing track: null while its spot is still being read. */
export const startOf = (spot: TrackSpot): number | null => {
  switch (spot.kind) {
    case TRACK_SPOTS.waiting:
      return null
    case TRACK_SPOTS.none:
      return 0
    case TRACK_SPOTS.saved:
      return spot.at
    default: {
      const unreachable: never = spot
      return unreachable
    }
  }
}

type SavesSpotOfProps = { track: Track; libraries: readonly Library[] }

/** Whether a track's spot is kept: its library's type keeps spots (audiobooks, never music), and the library does. */
const savesSpotOf = ({ track, libraries }: SavesSpotOfProps): boolean => {
  const library = libraries.find((candidate) => candidate.id === track.libraryId)
  if (library === undefined) return false
  const { settings } = library
  return KIND_RULES[settings.kind].saveProgress && settings.saveProgress
}

type UseTrackSpotProps = { api: ApiClient; track: Track | null }

/** A spot read for one track, kept until another plays. */
type Fixed = { id: number; spot: TrackSpot }

/**
 * The playing track's spot, read once as it starts: from the libraries whether it keeps one, and
 * for one that does, its media's saved position, asked of the server afresh rather than the
 * cache. Either read failing plays the track from its top and saves nothing, so a spot that
 * cannot be read is never written over.
 */
const useTrackSpot = ({ api, track }: UseTrackSpotProps): TrackSpot => {
  const queries = useMemo(() => ravenQueriesFor(api), [api])
  const libraries = useQuery({ ...queries.librariesQuery, enabled: track !== null })
  const isSaving =
    track !== null &&
    libraries.data !== undefined &&
    savesSpotOf({ track, libraries: libraries.data })
  const media = useQuery({
    ...queries.mediaQuery(isSaving ? (track?.id ?? null) : null),
    staleTime: 0,
  })
  const read = ((): TrackSpot => {
    if (libraries.isError) return NONE
    if (libraries.data === undefined) return WAITING
    if (!isSaving || media.isError) return NONE
    if (media.data === undefined || media.isFetching) return WAITING
    return { kind: TRACK_SPOTS.saved, at: resumeAtFor({ at: 0, media: media.data }) }
  })()
  const [fixed, setFixed] = useState<Fixed | null>(null)
  const id = track?.id ?? null
  if (id !== null && read.kind !== TRACK_SPOTS.waiting && (fixed === null || fixed.id !== id)) {
    setFixed({ id, spot: read })
  }
  if (id === null || fixed === null || fixed.id !== id) return WAITING
  return fixed.spot
}

/** One track's saves, from where it started to where it was left. */
type SpotReport = {
  id: number
  libraryId: number
  saver: ProgressSaver
  lastSaved: number
  hasStarted: boolean
  previous: VideoState
  position: number
}

type PlayerStateOfProps = { state: AudioState; position: number }

/** The queue's word on the player, as the progress rules read a video's. */
const playerStateOf = ({ state, position }: PlayerStateOfProps): VideoState => ({
  time: position,
  elementDuration: null,
  buffered: [],
  ended: false,
  paused: state !== AUDIO_STATES.playing && state !== AUDIO_STATES.loading,
  waiting: state === AUDIO_STATES.loading,
  rate: 1,
})

type StepProps = { id: number | null; state: AudioState; position: number; duration: number | null }

type UseSpotReportProps = {
  api: ApiClient
  track: Track | null
  spot: TrackSpot
  watchHide: WatchHide
}

/**
 * Saves a track's spot as a video's is: every `SAVE_EVERY_S` of play, on a pause, whenever the
 * host hides, and where it was left as another track plays, the queue empties or the host goes.
 * Only a track whose spot is kept reports, and only once it plays; a listen is counted apart.
 */
const useSpotReport = ({ api, track, spot, watchHide }: UseSpotReportProps): void => {
  const state = useAudioQueue((store) => store.state)
  const position = useAudioQueue((store) => store.position)
  const duration = useAudioQueue((store) => store.duration)
  const queryClient = useQueryClient()
  const report = useRef<SpotReport | null>(null)
  const id = track?.id ?? null
  const savedFrom = spot.kind === TRACK_SPOTS.saved ? spot.at : null

  const begin = useEffectEvent((at: number) => {
    const playing = track
    if (playing === null) return
    report.current = {
      id: playing.id,
      libraryId: playing.libraryId,
      saver: createProgressSaver({
        send: (progress) => api.saveProgress({ id: playing.id, ...progress }),
      }),
      lastSaved: at,
      hasStarted: false,
      previous: playerStateOf({ state: AUDIO_STATES.loading, position: at }),
      position: at,
    }
  })
  // The lists read again only once the last spot is in, or they would show the old one.
  const leave = useEffectEvent(() => {
    const current = report.current
    report.current = null
    if (current === null || !current.hasStarted) return
    current.saver.save({ position: current.position, audio: null })
    current.saver
      .settled()
      .then(() => afterWatching({ queryClient, libraryId: current.libraryId }))
      .catch(() => undefined)
  })
  // The track's id names it: a copy of the same track from a fresh fetch is no new track.
  useEffect(() => {
    if (id === null || savedFrom === null) return
    begin(savedFrom)
    return () => leave()
  }, [id, savedFrom])

  const step = useEffectEvent((now: StepProps) => {
    const current = report.current
    if (current === null || current.id !== now.id) return
    const player = playerStateOf({ state: now.state, position: now.position })
    const { isStarting, saveAt } = progressStepOf({
      state: player,
      previous: current.previous,
      hasStarted: current.hasStarted,
      lastSaved: current.lastSaved,
      position: now.position,
      duration: now.duration,
    })
    report.current = {
      ...current,
      previous: player,
      position: now.position,
      hasStarted: current.hasStarted || isStarting,
      lastSaved: saveAt ?? current.lastSaved,
    }
    if (saveAt !== null) current.saver.save({ position: saveAt, audio: null })
  })
  useEffect(() => step({ id, state, position, duration }), [id, state, position, duration])

  const hide = useEffectEvent(() => {
    const current = report.current
    if (current === null || !current.hasStarted) return
    report.current = { ...current, lastSaved: current.position }
    current.saver.save({ position: current.position, audio: null })
  })
  const watch = useEffectEvent(() => watchHide(() => hide()))
  useEffect(() => watch(), [])
}

type UseAudiobookSpotProps = {
  api: ApiClient
  track: Track | null
  /** Calls its save as the host is about to go away; the web's page hide, or nothing. */
  watchHide: WatchHide
}

/**
 * The playing track's spot for a host to start it from, saved as it plays when the track keeps
 * one: an audiobook's, never music's. Both audio hosts share it, the web's `<audio>` and the
 * windowed players, so a book resumes alike wherever it plays.
 */
export const useAudiobookSpot = ({ api, track, watchHide }: UseAudiobookSpotProps): TrackSpot => {
  const spot = useTrackSpot({ api, track })
  useSpotReport({ api, track, spot, watchHide })
  return spot
}
