import {
  type MediaItem,
  type MediaTracks,
  type PlaybackMode,
  type SubtitleTrack,
  formatChannels,
  resolutionLabel,
} from '@raven/core'
import { playingAudio } from '@/components/Player/selection'
import { audioLabel, subtitleLabel } from '@/lib/trackLabels'

/** How each mode reads in the chrome, short enough for a pill. */
const MODE_NAMES = {
  direct: 'Direct play',
  remux: 'Audio converted',
  transcode: 'Converted',
} as const satisfies Record<PlaybackMode, string>

const joined = ({
  parts,
  separator = ' · ',
}: {
  parts: ReadonlyArray<string | null>
  separator?: string
}): string => parts.filter((part): part is string => !!part).join(separator)

/** "4K HDR", "1080p", or null before the file is probed. */
export const pictureLabel = (media: MediaItem): string | null => {
  const resolution = resolutionLabel(media)
  if (resolution == null) return null
  return media.hdr ? `${resolution} HDR` : resolution
}

/**
 * The line under the player's title: the year, unless the title already
 * ends with it, then the picture and how it is playing.
 */
export const aboutLine = ({
  media,
  label,
  mode,
}: {
  media: MediaItem | null
  label: string
  mode: PlaybackMode
}): string => {
  const year = media?.item?.year ?? media?.year ?? null
  const shownYear = year != null && !label.includes(`(${year})`) ? String(year) : null
  return joined({ parts: [shownYear, media ? pictureLabel(media) : null, MODE_NAMES[mode]] })
}

/**
 * What reaches the screen and how, for the quality pill. A conversion's
 * size is the server's to pick, so only an untouched picture names its own.
 */
export const qualityLabel = ({
  media,
  mode,
}: {
  media: MediaItem | null
  mode: PlaybackMode
}): string => {
  const picture = media && mode !== 'transcode' ? resolutionLabel(media) : null
  return joined({ parts: [picture, MODE_NAMES[mode]] })
}

/** "English 5.1" for the audio pill; null until the tracks are read. */
export const audioPillLabel = ({
  mode,
  tracks,
  audio,
  playsPickedAudio,
}: {
  mode: PlaybackMode
  tracks: MediaTracks | null
  audio: number | null
  playsPickedAudio?: boolean
}): string | null => {
  const index = playingAudio({ mode, tracks, audio, playsPickedAudio })
  const track = tracks?.audio.find((candidate) => candidate.index === index) ?? null
  if (!track) return null
  return joined({ parts: [audioLabel(track).name, formatChannels(track.channels)], separator: ' ' })
}

/** The subtitles pill's language, or Off. */
export const subtitlePillLabel = (subtitle: SubtitleTrack | null): string =>
  subtitle ? subtitleLabel(subtitle).name : 'Off'
