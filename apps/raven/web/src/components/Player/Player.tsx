import { useQuery } from '@tanstack/react-query'
import { type MediaItem, type PlaybackMode, type SubtitleTrack, planPlayback } from '@raven/core'
import { useCallback, useMemo, useState } from 'react'
import styles from '@/components/Player/Player.module.scss'
import { preferredAudio, preferredSubtitle } from '@/components/Player/selection'
import { Stage } from '@/components/Player/Stage'
import { Unplayable } from '@/components/Player/Unplayable'
import { api } from '@/lib/api'
import { browserCanPlay, browserCanStream } from '@/lib/canPlay'
import { queryKeys } from '@/lib/queryClient'
import { usePlayerPrefs } from '@/stores/playerPrefs'

/**
 * Picks how to play a file and which tracks to play, then hands over to
 * the stage. The original file goes straight to the browser when it can
 * take it; otherwise, or for any audio track but the default, the server
 * converts it. When a way fails mid-play, the next one down is tried from
 * the same spot, and only when every way has failed does the viewer get
 * the "can't play" panel.
 */
export const Player = ({ media, backTo }: { media: MediaItem; backTo: string }) => {
  const prefs = usePlayerPrefs()
  const tracksQuery = useQuery({
    queryKey: queryKeys.mediaTracks(media.id),
    queryFn: () => api.getTracks(media.id),
    staleTime: Infinity,
    retry: false,
  })
  const tracks = tracksQuery.data ?? null

  // Picks by hand win over the remembered preferences.
  const [audioPick, setAudioPick] = useState<number | null>(null)
  const [subtitlePick, setSubtitlePick] = useState<{ id: string | null } | null>(null)
  const audio = audioPick ?? preferredAudio({ tracks, language: prefs.audioLanguage })
  const subtitleId = subtitlePick
    ? subtitlePick.id
    : preferredSubtitle({ tracks, subtitles: prefs.subtitles })
  const subtitle = tracks?.subtitles.find((track) => track.id === subtitleId) ?? null

  const defaultAudio = audio == null || audio === tracks?.defaultAudio
  const plan = useMemo(
    () =>
      planPlayback({ media, canPlay: browserCanPlay, canStream: browserCanStream, defaultAudio }),
    [media, defaultAudio],
  )
  const [forced, setForced] = useState(false)
  const modes: PlaybackMode[] = plan.modes.length === 0 && forced ? ['direct'] : plan.modes
  // A step down the ladder belongs to one plan; a new audio track starts at the top.
  const ladder = `${modes.join(',')}|${audio ?? 'default'}`
  const [fallback, setFallback] = useState({ ladder: '', step: 0 })
  const step = fallback.ladder === ladder ? fallback.step : 0
  const mode = modes[step] ?? null
  const [failure, setFailure] = useState<string | null>(null)

  const onFailure = useCallback(
    (message: string) => {
      if (step + 1 < modes.length) setFallback({ ladder, step: step + 1 })
      else setFailure(message)
    },
    [step, modes.length, ladder],
  )

  const pickAudio = useCallback(
    (index: number) => {
      setAudioPick(index)
      prefs.setAudioLanguage(tracks?.audio.find((track) => track.index === index)?.language ?? null)
    },
    [prefs, tracks],
  )

  const pickSubtitle = useCallback(
    (id: string | null) => {
      setSubtitlePick({ id })
      const track = tracks?.subtitles.find((candidate) => candidate.id === id)
      prefs.setSubtitles({
        on: id != null,
        language: track ? track.language : prefs.subtitles.language,
      })
    },
    [prefs, tracks],
  )

  const toggleSubtitles = useCallback((): SubtitleTrack | null => {
    if (subtitle != null) {
      pickSubtitle(null)
      return null
    }
    const id =
      preferredSubtitle({ tracks, subtitles: { on: true, language: prefs.subtitles.language } }) ??
      preferredSubtitle({ tracks, subtitles: { on: true, language: null } })
    pickSubtitle(id)
    return tracks?.subtitles.find((track) => track.id === id) ?? null
  }, [subtitle, tracks, prefs.subtitles.language, pickSubtitle])

  if (failure != null || mode == null) {
    return (
      <Unplayable
        media={media}
        backTo={backTo}
        problems={failure != null ? [failure, ...plan.problems] : plan.problems}
        onTryAnyway={failure == null && !forced ? () => setForced(true) : null}
      />
    )
  }

  // A remembered audio language may mean a converted stream; wait for the
  // track list rather than start one source only to swap it.
  if (prefs.audioLanguage != null && tracksQuery.isPending && audioPick == null) {
    return (
      <div className={styles.stage} aria-busy="true">
        <output className={styles.spinner} aria-label="Loading" />
      </div>
    )
  }

  return (
    <Stage
      media={media}
      backTo={backTo}
      mode={mode}
      audio={audio}
      tracks={tracks}
      tracksFailed={tracksQuery.isError}
      subtitle={subtitle}
      onFailure={onFailure}
      onPickAudio={pickAudio}
      onPickSubtitle={pickSubtitle}
      onToggleSubtitles={toggleSubtitles}
    />
  )
}
