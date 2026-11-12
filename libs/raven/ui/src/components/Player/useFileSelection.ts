import type { MediaTracks } from '@raven/core'
import { useMemo, useState } from 'react'
import type { FileSubtitles } from '@/components/Player/engine'
import { preferredSubtitle } from '@/components/Player/selection'
import type { TrackSelection } from '@/components/Player/useTrackSelection'
import { usePlayerPrefs } from '@/stores/playerPrefs'

// `{ id: null }` is a pick of Off; no pick at all is null.
type SubtitlePick = { id: string | null }

/**
 * A local file's tracks. The file plays its own sound, so there is no audio to pick; the
 * subtitles are the ones its host kept beside it, picked as a server video's are: a pick by hand
 * wins over the remembered preference and is remembered for the next video. A file whose host
 * kept none has no tracks at all.
 */
export const useFileSelection = (subtitles: FileSubtitles | undefined): TrackSelection => {
  const subtitlePrefs = usePlayerPrefs((prefs) => prefs.subtitles)
  const setSubtitles = usePlayerPrefs((prefs) => prefs.setSubtitles)
  const [pick, setPick] = useState<SubtitlePick | null>(null)
  const tracks = useMemo<MediaTracks | null>(
    () =>
      subtitles === undefined
        ? null
        : { audio: [], subtitles: [...subtitles.tracks], defaultAudio: null, frameRate: null },
    [subtitles],
  )
  const subtitleId = pick ? pick.id : preferredSubtitle({ tracks, subtitles: subtitlePrefs })
  return {
    tracks,
    tracksFailed: false,
    tracksPending: false,
    audio: null,
    isDefaultAudio: true,
    subtitle: tracks?.subtitles.find((track) => track.id === subtitleId) ?? null,
    isWaitingForTracks: false,
    pickAudio: () => {},
    pickSubtitle: (id) => {
      setPick({ id })
      const track = tracks?.subtitles.find((candidate) => candidate.id === id) ?? null
      setSubtitles({
        on: id != null,
        language: track === null ? subtitlePrefs.language : track.language,
      })
    },
  }
}
