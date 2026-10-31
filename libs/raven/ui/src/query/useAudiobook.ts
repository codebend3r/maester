import { useQuery } from '@tanstack/react-query'
import type { ApiClient, AudioBitrate, Chapter, Track } from '@raven/core'
import { useMemo } from 'react'
import { isAudiobookTrack } from '@/lib/chapters'
import { ravenQueriesFor } from '@/query/ravenQueries'
import { MUSIC_QUALITIES, usePlayerPrefs } from '@/stores/playerPrefs'

/** What a track that is no audiobook's has of chapters. */
const NO_CHAPTERS: readonly Chapter[] = []

type UseIsAudiobookProps = { api: ApiClient; track: Track | null }

/**
 * Whether `track` is an audiobook's, read from the libraries the side menu
 * already holds. False while they are on their way, so a book plays at its
 * normal speed for that moment; with nothing playing they are not asked for.
 */
export const useIsAudiobook = ({ api, track }: UseIsAudiobookProps): boolean => {
  const queries = useMemo(() => ravenQueriesFor(api), [api])
  const libraries = useQuery({ ...queries.librariesQuery, enabled: track !== null }).data ?? []
  return track !== null && isAudiobookTrack({ track, libraries })
}

/** How fast music plays: as it was recorded. */
const MUSIC_RATE = 1

type UseTrackRateProps = { api: ApiClient; track: Track | null }

/**
 * How fast `track` plays: an audiobook's at the speed the prefs hold, music
 * at 1. Every audio host reads it, so a book reads alike wherever it plays.
 */
export const useTrackRate = ({ api, track }: UseTrackRateProps): number => {
  const isAudiobook = useIsAudiobook({ api, track })
  const speed = usePlayerPrefs((prefs) => prefs.audiobookSpeed)
  return isAudiobook ? speed : MUSIC_RATE
}

type UseTrackBitrateProps = { api: ApiClient; track: Track | null }

/**
 * The AAC transcode's bitrate `track` plays at: the one the prefs pick for music, null for its
 * file. An audiobook always plays its file, which a transcode would have to convert whole before
 * the first second plays, so while the libraries that tell a book from music are unknown (on
 * their way, or failed) the file is asked for too.
 */
export const useTrackBitrate = ({ api, track }: UseTrackBitrateProps): AudioBitrate | null => {
  const queries = useMemo(() => ravenQueriesFor(api), [api])
  const quality = usePlayerPrefs((prefs) => prefs.musicQuality)
  const libraries = useQuery({ ...queries.librariesQuery, enabled: track !== null }).data
  if (track === null || libraries === undefined || quality === MUSIC_QUALITIES.original) {
    return null
  }
  return isAudiobookTrack({ track, libraries }) ? null : quality
}

type UseAudiobookChaptersProps = { api: ApiClient; track: Track | null }

/**
 * An audiobook's chapters, from its file's markers, and whether it is one.
 * Music asks for none: a chapter is an audiobook's alone, and its intro is
 * never read, so no audio ever offers Skip intro.
 */
export const useAudiobookChapters = ({ api, track }: UseAudiobookChaptersProps) => {
  const queries = useMemo(() => ravenQueriesFor(api), [api])
  const isAudiobook = useIsAudiobook({ api, track })
  const chapters = useQuery(queries.chaptersQuery(isAudiobook ? (track?.id ?? null) : null))
  return { isAudiobook, chapters: chapters.data ?? NO_CHAPTERS }
}
