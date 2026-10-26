import { useQuery } from '@tanstack/react-query'
import type { ApiClient, MediaTracks, SubtitleTrack } from '@raven/core'
import { useState } from 'react'
import { preferredAudio, preferredSubtitle } from '@/components/Player/selection'
import { playerQueriesFor } from '@/lib/playerQueries'
import { usePlayerPrefs } from '@/stores/playerPrefs'

/** The file's tracks, which of them play, and the ways to change that. */
export type TrackSelection = {
  tracks: MediaTracks | null
  tracksFailed: boolean
  tracksPending: boolean
  /** The `0:a:N` track to play, or null for the file's default. */
  audio: number | null
  /** Whether the audio playing is the file's own default, which direct play gets without help. */
  isDefaultAudio: boolean
  subtitle: SubtitleTrack | null
  /**
   * A remembered audio language may mean a converted stream; while the track
   * list is on its way, no source should start only to be swapped.
   */
  isWaitingForTracks: boolean
  /** The engine switches tracks itself, so the menu shows the pick even when nothing is converted. */
  playsPickedAudio?: boolean
  pickAudio: (index: number | null) => void
  pickSubtitle: (id: string | null) => void
}

type UseTrackSelectionProps = {
  mediaId: number
  api: ApiClient
}

/**
 * Which audio and subtitle tracks play. A pick by hand wins over the
 * remembered preferences, and is remembered for the next video.
 */
export const useTrackSelection = ({ mediaId, api }: UseTrackSelectionProps): TrackSelection => {
  const audioLanguage = usePlayerPrefs((prefs) => prefs.audioLanguage)
  const subtitlePrefs = usePlayerPrefs((prefs) => prefs.subtitles)
  const setAudioLanguage = usePlayerPrefs((prefs) => prefs.setAudioLanguage)
  const setSubtitles = usePlayerPrefs((prefs) => prefs.setSubtitles)
  const trackList = useQuery(playerQueriesFor(api).tracks(mediaId))
  const tracks = trackList.data ?? null

  const [audioPick, setAudioPick] = useState<number | null>(null)
  // `{ id: null }` is a pick of Off; null is no pick at all.
  const [subtitlePick, setSubtitlePick] = useState<{ id: string | null } | null>(null)
  const audio = audioPick ?? preferredAudio({ tracks, language: audioLanguage })
  const subtitleId = subtitlePick
    ? subtitlePick.id
    : preferredSubtitle({ tracks, subtitles: subtitlePrefs })
  const subtitle = tracks?.subtitles.find((track) => track.id === subtitleId) ?? null

  const pickSubtitle = (id: string | null) => {
    setSubtitlePick({ id })
    const track = tracks?.subtitles.find((candidate) => candidate.id === id) ?? null
    setSubtitles({
      on: id != null,
      language: track === null ? subtitlePrefs.language : track.language,
    })
  }

  return {
    tracks,
    tracksFailed: trackList.isError,
    tracksPending: trackList.isPending,
    audio,
    isDefaultAudio: audio == null || audio === (tracks?.defaultAudio ?? null),
    subtitle,
    isWaitingForTracks: audioLanguage != null && trackList.isPending && audioPick == null,
    pickAudio: (index) => {
      setAudioPick(index)
      setAudioLanguage(tracks?.audio.find((track) => track.index === index)?.language ?? null)
    },
    pickSubtitle,
  }
}
