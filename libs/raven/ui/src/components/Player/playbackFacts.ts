import {
  ITEM_TYPES,
  type MediaItem,
  type MediaTracks,
  PLAYBACK_MODES,
  type PlaybackMode,
  type Resolution,
  STREAM_QUALITIES,
  type StreamQuality,
  type SubtitleTrack,
  audioLabel,
  codecLabel,
  episodeTag,
  formatBitrate,
  formatChannels,
  formatRuntime,
  rangeLabel,
  resolutionLabel,
  subtitleLabel,
} from '@raven/core'
import { PLAYBACK_FACTS_COPY, PLAYBACK_MODE_NAMES } from '@/components/Player/copy'
import { playingAudio } from '@/components/Player/selection'
import type { StepDown } from '@/components/Player/usePlaybackLadder'

/** Each mode as the subject of a sentence. */
const MODE_NOUNS = {
  direct: 'the original file',
  remux: 'the remux',
  transcode: 'the transcode',
} as const satisfies Record<PlaybackMode, string>

type JoinedProps = {
  parts: ReadonlyArray<string | null>
  separator?: string
}

const joined = ({ parts, separator = ' · ' }: JoinedProps): string =>
  parts.filter((part): part is string => !!part).join(separator)

/** "4K HDR", "1080p", or null before the file is probed. */
export const pictureLabel = (media: MediaItem): string | null => {
  const resolution = resolutionLabel(media)
  if (resolution == null) return null
  return media.hdr ? PLAYBACK_FACTS_COPY.hdr(resolution) : resolution
}

/** What the player's header calls the title: a show's name over an episode's own, else the host's label. */
export type HeaderTitle = {
  /** The heading's words, where the title has no art: the show's for an episode. */
  name: string
  /** The episode's own title, on the line under the heading; null for anything but an episode. */
  episode: string | null
}

type HeaderTitleOfProps = { media: MediaItem | null; label: string }

/** The header's heading and an episode's own title under it; a film or a local file keeps the label. */
export const headerTitleOf = ({ media, label }: HeaderTitleOfProps): HeaderTitle => {
  const item = media?.item
  if (item?.type !== ITEM_TYPES.episode) return { name: label, episode: null }
  return { name: item.show?.title ?? label, episode: item.title === '' ? null : item.title }
}

type AboutLineProps = {
  media: MediaItem | null
  label: string
  context?: string | null
  /** The video's length in seconds, null while unknown. */
  duration?: number | null
}

/**
 * The line under the player's title: where the title came from when the host
 * names it, an episode's season and number ("S01 · E02"), the runtime, and
 * the year, unless the title already ends with it. The picture and how it
 * plays have chips of their own at the far end of the bar.
 */
export const aboutLine = ({
  media,
  label,
  context = null,
  duration = null,
}: AboutLineProps): string => {
  const item = media?.item
  const tag = item?.type === ITEM_TYPES.episode ? episodeTag(item) : null
  const year = item?.year ?? media?.year ?? null
  const shownYear = year != null && !label.includes(`(${year})`) ? String(year) : null
  return joined({ parts: [context, tag, formatRuntime(duration), shownYear] })
}

type QualityLabelProps = {
  media: MediaItem | null
  mode: PlaybackMode
  quality?: StreamQuality | null
}

/**
 * What reaches the screen and how, for the quality pill. A conversion's
 * size is the server's to pick, so only an untouched picture names its own.
 */
export const qualityLabel = ({ media, mode, quality = null }: QualityLabelProps): string => {
  if (mode === PLAYBACK_MODES.transcode && quality != null) {
    return joined({
      parts: [
        PLAYBACK_FACTS_COPY.height(STREAM_QUALITIES[quality].height),
        PLAYBACK_MODE_NAMES[mode],
      ],
    })
  }
  const picture = media && mode !== PLAYBACK_MODES.transcode ? resolutionLabel(media) : null
  return joined({ parts: [picture, PLAYBACK_MODE_NAMES[mode]] })
}

/**
 * The resolution that reaches the screen, for the top bar's quality chip:
 * the file's own unless it is transcoded, then the size picked, never above
 * the file's. Null before the file is probed, and for a transcode at the
 * server's own size, which the player does not know.
 */
export const playingResolution = ({
  media,
  mode,
  quality = null,
}: QualityLabelProps): Resolution | null => {
  if (media == null) return null
  if (mode !== PLAYBACK_MODES.transcode) return resolutionLabel(media)
  if (quality == null || media.width == null || media.height == null) return null
  // The server caps the height and keeps the shape, never scaling up.
  const scale = Math.min(1, STREAM_QUALITIES[quality].height / media.height)
  return resolutionLabel({
    width: Math.round(media.width * scale),
    height: Math.round(media.height * scale),
  })
}

type PlayingRangeProps = { media: MediaItem | null; mode: PlaybackMode }

/**
 * The file's high range of light (`HDR`, `DV5`) while the picture reaches
 * the screen untouched; null for SDR, an unknown file, or a transcode, which
 * the server may tone map.
 */
export const playingRange = ({ media, mode }: PlayingRangeProps): string | null => {
  if (media == null || mode === PLAYBACK_MODES.transcode) return null
  return rangeLabel(media)
}

/**
 * The file's video codec (`HEVC`) while the picture reaches the screen as
 * the file has it; null for an unknown file or a transcode, which the
 * server encodes afresh.
 */
export const playingCodec = ({ media, mode }: PlayingRangeProps): string | null => {
  if (!media?.videoCodec || mode === PLAYBACK_MODES.transcode) return null
  return codecLabel(media.videoCodec)
}

/** "24.2 Mbps, 4K HDR" for the original in the quality list; null before the file is probed. */
export const originalDetails = (media: MediaItem): string | null => {
  const text = joined({
    parts: [formatBitrate(media.bitrate), pictureLabel(media)],
    separator: ', ',
  })
  return text === '' ? null : text
}

type AudioPillLabelProps = {
  mode: PlaybackMode
  tracks: MediaTracks | null
  audio: number | null
  playsPickedAudio?: boolean
}

/** "English 5.1" for the audio pill; null until the tracks are read. */
export const audioPillLabel = ({
  mode,
  tracks,
  audio,
  playsPickedAudio,
}: AudioPillLabelProps): string | null => {
  const index = playingAudio({ mode, tracks, audio, playsPickedAudio })
  const track = tracks?.audio.find((candidate) => candidate.index === index) ?? null
  if (!track) return null
  return joined({ parts: [audioLabel(track).name, formatChannels(track.channels)], separator: ' ' })
}

/** The subtitles pill's language, or Off. */
export const subtitlePillLabel = (subtitle: SubtitleTrack | null): string =>
  subtitle ? subtitleLabel({ track: subtitle }).name : PLAYBACK_FACTS_COPY.subtitlesOff

/** Why the picture is a transcode when the connection could not carry the way above it. */
export const stepDownNote = ({ from, delivery }: StepDown): string => {
  const carried = formatBitrate(delivery.delivered)
  const needed = formatBitrate(delivery.needed)
  return needed == null
    ? PLAYBACK_FACTS_COPY.stepDown(carried)
    : PLAYBACK_FACTS_COPY.stepDownWithNeed({ carried, noun: MODE_NOUNS[from], needed })
}

type EndsAtLabelProps = {
  now: number
  time: number
  duration: number | null
  rate: number
  locale?: string
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
}: EndsAtLabelProps): string | null => {
  if (duration == null || rate <= 0) return null
  const remaining = Math.max(0, duration - time) / rate
  const clock = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' })
  return PLAYBACK_FACTS_COPY.endsAt(clock.format(now + remaining * 1_000))
}
