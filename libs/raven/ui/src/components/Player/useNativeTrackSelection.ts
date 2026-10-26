import type { MediaTracks } from '@raven/core'
import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { type NativePlayer, sendQuietly } from '@/components/Player/engine'
import { useHostServices } from '@/stores/playerServices'
import { preferredAudio, preferredSubtitle } from '@/components/Player/selection'
import type { TrackSelection } from '@/components/Player/useTrackSelection'
import { usePlayerPrefs } from '@/stores/playerPrefs'

type UseNativeTrackSelectionProps = {
  tracks: MediaTracks | null
  player: NativePlayer
}

/**
 * Which audio and subtitle tracks the player in the other process plays. The
 * stored pick starts it; otherwise the language preferences apply once, when
 * the tracks first arrive. Only a pick by hand the player accepted is saved.
 */
export const useNativeTrackSelection = ({
  tracks,
  player,
}: UseNativeTrackSelectionProps): TrackSelection => {
  const { trackPicks } = useHostServices()
  const audioLanguage = usePlayerPrefs((prefs) => prefs.audioLanguage)
  const subtitlePrefs = usePlayerPrefs((prefs) => prefs.subtitles)
  const setAudioLanguage = usePlayerPrefs((prefs) => prefs.setAudioLanguage)
  const setSubtitles = usePlayerPrefs((prefs) => prefs.setSubtitles)
  const [audio, setAudio] = useState<number | null>(trackPicks?.start?.audio ?? null)
  const [subtitleId, setSubtitleId] = useState<string | null>(trackPicks?.start?.subtitle ?? null)
  const hasPrefsApplied = useRef(false)

  const applyPreferences = useEffectEvent((available: MediaTracks) => {
    if ((trackPicks?.start ?? null) !== null) return
    const audioPick = preferredAudio({ tracks: available, language: audioLanguage })
    const subtitlePick = preferredSubtitle({ tracks: available, subtitles: subtitlePrefs })
    if (audioPick != null) {
      setAudio(audioPick)
      sendQuietly({ player, command: { type: 'audio', index: audioPick } })
    }
    if (subtitlePick != null) {
      setSubtitleId(subtitlePick)
      sendQuietly({ player, command: { type: 'subtitle', id: subtitlePick } })
    }
  })
  useEffect(() => {
    if (tracks == null || hasPrefsApplied.current) return
    hasPrefsApplied.current = true
    applyPreferences(tracks)
  }, [tracks])

  // A refused pick puts back what played before, unless another pick has replaced it since.
  const pickAudio = (index: number | null) => {
    const previous = audio
    setAudio(index)
    sendQuietly({
      player,
      command: { type: 'audio', index },
      onAccepted: () => {
        setAudioLanguage(tracks?.audio.find((track) => track.index === index)?.language ?? null)
        if (trackPicks) trackPicks.save({ audio: index, subtitle: subtitleId })
      },
      onRefused: () => setAudio((shown) => (shown === index ? previous : shown)),
    })
  }

  const pickSubtitle = (id: string | null) => {
    const previous = subtitleId
    setSubtitleId(id)
    sendQuietly({
      player,
      command: { type: 'subtitle', id },
      onAccepted: () => {
        const track = tracks?.subtitles.find((candidate) => candidate.id === id) ?? null
        setSubtitles({
          on: id != null,
          language: track === null ? subtitlePrefs.language : track.language,
        })
        if (trackPicks) trackPicks.save({ audio, subtitle: id })
      },
      onRefused: () => setSubtitleId((shown) => (shown === id ? previous : shown)),
    })
  }

  return {
    tracks,
    tracksFailed: false,
    tracksPending: tracks === null,
    audio,
    isDefaultAudio: audio == null || audio === (tracks?.defaultAudio ?? null),
    subtitle: tracks?.subtitles.find((track) => track.id === subtitleId) ?? null,
    isWaitingForTracks: false,
    playsPickedAudio: true,
    pickAudio,
    pickSubtitle,
  }
}
