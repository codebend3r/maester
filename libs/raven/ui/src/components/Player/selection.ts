import { type MediaTracks, PLAYBACK_MODES, type PlaybackMode } from '@raven/core'

type PreferredAudioProps = {
  tracks: MediaTracks | null
  language: string | null
}

/**
 * The audio track to start on: the file's default, unless the viewer last
 * picked another language by hand and this file has it. Null means the
 * default, which direct play gets without help.
 */
export const preferredAudio = ({ tracks, language }: PreferredAudioProps): number | null => {
  if (!tracks || language == null) return null
  const standard = tracks.audio.find((track) => track.index === tracks.defaultAudio)
  if (standard?.language === language) return null
  return tracks.audio.find((track) => track.language === language)?.index ?? null
}

type PreferredSubtitleProps = {
  tracks: MediaTracks | null
  subtitles: { on: boolean; language: string | null }
}

/**
 * The subtitle track to start on: none while subtitles were last off;
 * otherwise a full (not forced) track in the last language used, or any
 * showable track when no language was remembered.
 */
export const preferredSubtitle = ({ tracks, subtitles }: PreferredSubtitleProps): string | null => {
  if (!tracks || !subtitles.on) return null
  const matching = tracks.subtitles.filter(
    (track) =>
      track.supported && (subtitles.language == null || track.language === subtitles.language),
  )
  return (matching.find((track) => !track.forced) ?? matching[0])?.id ?? null
}

type PlayingAudioProps = {
  mode: PlaybackMode
  tracks: MediaTracks | null
  audio: number | null
  playsPickedAudio?: boolean
}

/**
 * The audio track playing: the picked one, else the file's default. The
 * original file plays its own default track, whichever was picked, unless
 * the engine switches tracks itself.
 */
export const playingAudio = ({
  mode,
  tracks,
  audio,
  playsPickedAudio = false,
}: PlayingAudioProps): number | null =>
  mode === PLAYBACK_MODES.direct && !playsPickedAudio
    ? (tracks?.defaultAudio ?? null)
    : (audio ?? tracks?.defaultAudio ?? null)
