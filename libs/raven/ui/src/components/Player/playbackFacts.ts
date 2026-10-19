import {
  type MediaItem,
  type MediaTracks,
  PLAYBACK_MODES,
  type PlaybackMode,
  STREAM_QUALITIES,
  type StreamQuality,
  type SubtitleTrack,
  formatBitrate,
  formatChannels,
  resolutionLabel,
} from '@raven/core'
import { playingAudio } from '@/components/Player/selection'
import type { StepDown } from '@/components/Player/usePlaybackLadder'
import { audioLabel, subtitleLabel } from '@/lib/trackLabels'

/** How each mode reads in the chrome, short enough for a pill. */
const MODE_NAMES = {
  direct: 'Direct play',
  remux: 'Audio converted',
  transcode: 'Converted',
} as const satisfies Record<PlaybackMode, string>

/** Each mode as the subject of a sentence. */
const MODE_NOUNS = {
  direct: 'the original file',
  remux: 'the remux',
  transcode: 'the transcode',
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
 * The line under the player's title: where the title came from when the host
 * names it, the year, unless the title already ends with it, then the picture
 * and how it is playing.
 */
export const aboutLine = ({
  media,
  label,
  mode,
  context = null,
}: {
  media: MediaItem | null
  label: string
  mode: PlaybackMode
  context?: string | null
}): string => {
  const year = media?.item?.year ?? media?.year ?? null
  const shownYear = year != null && !label.includes(`(${year})`) ? String(year) : null
  return joined({
    parts: [context, shownYear, media ? pictureLabel(media) : null, MODE_NAMES[mode]],
  })
}

/**
 * What reaches the screen and how, for the quality pill. A conversion's
 * size is the server's to pick, so only an untouched picture names its own.
 */
export const qualityLabel = ({
  media,
  mode,
  quality = null,
}: {
  media: MediaItem | null
  mode: PlaybackMode
  quality?: StreamQuality | null
}): string => {
  if (mode === PLAYBACK_MODES.transcode && quality != null) {
    return joined({ parts: [`${STREAM_QUALITIES[quality].height}p`, MODE_NAMES[mode]] })
  }
  const picture = media && mode !== PLAYBACK_MODES.transcode ? resolutionLabel(media) : null
  return joined({ parts: [picture, MODE_NAMES[mode]] })
}

/** "24.2 Mbps, 4K HDR" for the original in the quality list; null before the file is probed. */
export const originalDetails = (media: MediaItem): string | null => {
  const text = joined({
    parts: [formatBitrate(media.bitrate), pictureLabel(media)],
    separator: ', ',
  })
  return text === '' ? null : text
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

/** Why the picture is a transcode when the connection could not carry the way above it. */
export const stepDownNote = ({ from, delivery }: StepDown): string => {
  const carried = formatBitrate(delivery.delivered)
  const needed = formatBitrate(delivery.needed)
  return needed == null
    ? `Switched to a transcode because the connection carried only ${carried}.`
    : `Switched to a transcode because the connection carried ${carried} and ${MODE_NOUNS[from]} needs ${needed}.`
}

/**
 * "Ends at 2:20 AM": the clock time the video ends at `rate`, from `now`;
 * null while its length is unknown. `locale` is the browser's unless a test
 * names one.
 */
export const endsAtLabel = ({
  now,
  time,
  duration,
  rate,
  locale,
}: {
  now: number
  time: number
  duration: number | null
  rate: number
  locale?: string
}): string | null => {
  if (duration == null || rate <= 0) return null
  const remaining = Math.max(0, duration - time) / rate
  const clock = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' })
  return `Ends at ${clock.format(now + remaining * 1_000)}`
}
