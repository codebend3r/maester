import {
  HLS_SEGMENT_SECONDS,
  PLAYBACK_MODES,
  type PlaybackMode,
  type SubtitleTrack,
  subtitleLabel,
} from '@raven/core'
import { type SegmentPlan, segmentDurations } from '@/hls/segmentPlan'

export type SubtitleRendition = { track: SubtitleTrack; uri: string }

const SUBTITLE_GROUP = 'subs'

const yesNo = (value: boolean): 'YES' | 'NO' => (value ? 'YES' : 'NO')

/** A quoted attribute value has no escape in RFC 8216, so a quote or a line break cannot appear in one. */
const quoted = (value: string): string => `"${value.replace(/["\r\n]/g, '')}"`

const extinf = (seconds: number): string => `#EXTINF:${seconds.toFixed(3)},`

/** `NAME` must be unique within a group: a repeat of a label gets its count after it. */
const uniqueNames = (labels: readonly string[]): string[] =>
  labels.reduce<{ names: string[]; counts: Map<string, number> }>(
    ({ names, counts }, label) => {
      const count = (counts.get(label) ?? 0) + 1
      return {
        names: [...names, count === 1 ? label : `${label} ${count}`],
        counts: new Map(counts).set(label, count),
      }
    },
    { names: [], counts: new Map() },
  ).names

const renditionName = (track: SubtitleTrack): string => {
  const { name, details } = subtitleLabel(track)
  return details ? `${name} (${details})` : name
}

const mediaLine = ({ track, uri, name }: SubtitleRendition & { name: string }): string =>
  [
    '#EXT-X-MEDIA:TYPE=SUBTITLES',
    `GROUP-ID=${quoted(SUBTITLE_GROUP)}`,
    `NAME=${quoted(name)}`,
    ...(track.language == null ? [] : [`LANGUAGE=${quoted(track.language)}`]),
    'DEFAULT=NO',
    `AUTOSELECT=${yesNo(track.forced)}`,
    `FORCED=${yesNo(track.forced)}`,
    `URI=${quoted(uri)}`,
  ].join(',')

/**
 * The master playlist: one variant, and a rendition for each text subtitle
 * track (a picture track has none). The caller builds every URI so each
 * carries the request's ticket. Open-GOP remux segments begin with leading
 * pictures that need the previous segment, so only a transcode, which cuts
 * at closed keyframes, may claim independent segments.
 */
export const masterPlaylist = ({
  mode,
  variantUri,
  subtitles,
  codecs,
  resolution,
  bandwidth,
}: {
  mode: PlaybackMode
  variantUri: string
  subtitles: readonly SubtitleRendition[]
  codecs: string
  resolution: { width: number; height: number }
  bandwidth: number
}): string => {
  const renditions = subtitles.filter(({ track }) => track.supported)
  const names = uniqueNames(renditions.map(({ track }) => renditionName(track)))
  const streamInf = [
    `#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth}`,
    `CODECS=${quoted(codecs)}`,
    `RESOLUTION=${resolution.width}x${resolution.height}`,
    ...(renditions.length === 0 ? [] : [`SUBTITLES=${quoted(SUBTITLE_GROUP)}`]),
  ].join(',')

  return [
    '#EXTM3U',
    '#EXT-X-VERSION:7',
    ...(mode === PLAYBACK_MODES.transcode ? ['#EXT-X-INDEPENDENT-SEGMENTS'] : []),
    ...renditions.map((rendition, index) => mediaLine({ ...rendition, name: names[index] ?? '' })),
    streamInf,
    variantUri,
    '',
  ].join('\n')
}

/** The video playlist: every segment of the plan, behind the init segment. */
export const mediaPlaylist = ({
  plan,
  initUri,
  segmentUri,
}: {
  plan: SegmentPlan
  initUri: string
  segmentUri: (n: number) => string
}): string => {
  const durations = segmentDurations(plan)
  return [
    '#EXTM3U',
    '#EXT-X-VERSION:7',
    '#EXT-X-PLAYLIST-TYPE:VOD',
    `#EXT-X-TARGETDURATION:${Math.ceil(Math.max(...durations))}`,
    `#EXT-X-MAP:URI=${quoted(initUri)}`,
    ...durations.flatMap((seconds, n) => [extinf(seconds), segmentUri(n)]),
    '#EXT-X-ENDLIST',
    '',
  ].join('\n')
}

/** A subtitle track's playlist: six-second WebVTT segments, the last one shorter. */
export const subtitlePlaylist = ({
  duration,
  segmentUri,
}: {
  duration: number
  segmentUri: (n: number) => string
}): string => {
  const durationMs = Math.round(duration * 1000)
  const segmentMs = HLS_SEGMENT_SECONDS * 1000
  const count = Math.ceil(durationMs / segmentMs)
  return [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    '#EXT-X-PLAYLIST-TYPE:VOD',
    `#EXT-X-TARGETDURATION:${HLS_SEGMENT_SECONDS}`,
    ...Array.from({ length: count }, (_, n) => [
      extinf(Math.min(segmentMs, durationMs - n * segmentMs) / 1000),
      segmentUri(n),
    ]).flat(),
    '#EXT-X-ENDLIST',
    '',
  ].join('\n')
}
