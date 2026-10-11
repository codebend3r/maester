import type { MediaTracks } from '@raven/core'

/**
 * The audio track to start on: the file's default, unless the viewer last
 * picked another language by hand and this file has it. Null means the
 * default, which direct play gets without help.
 */
export const preferredAudio = ({
  tracks,
  language,
}: {
  tracks: MediaTracks | null
  language: string | null
}): number | null => {
  if (!tracks || language == null) return null
  const standard = tracks.audio.find((track) => track.index === tracks.defaultAudio)
  if (standard?.language === language) return null
  return tracks.audio.find((track) => track.language === language)?.index ?? null
}

/**
 * The subtitle track to start on: none while subtitles were last off;
 * otherwise a full (not forced) track in the last language used, or any
 * showable track when no language was remembered.
 */
export const preferredSubtitle = ({
  tracks,
  subtitles,
}: {
  tracks: MediaTracks | null
  subtitles: { on: boolean; language: string | null }
}): string | null => {
  if (!tracks || !subtitles.on) return null
  const matching = tracks.subtitles.filter(
    (track) =>
      track.supported && (subtitles.language == null || track.language === subtitles.language),
  )
  return (matching.find((track) => !track.forced) ?? matching[0])?.id ?? null
}
