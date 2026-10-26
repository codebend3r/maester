import {
  HLS_SEGMENT_SECONDS,
  PLAYBACK_MODES,
  type PlaybackMode,
  type SubtitleTrack,
  subtitleLabel,
} from '@raven/core'
import { type SegmentPlan, segmentDurations } from '@/hls/segmentPlan'

type SubtitleRendition = { track: SubtitleTrack; uri: string }

const SUBTITLE_GROUP = 'subs'

/** RFC 8216's enumerated values for an attribute that is on or off. */
const HLS_SWITCH = { yes: 'YES', no: 'NO' } as const

const yesNo = (isYes: boolean) => (isYes ? HLS_SWITCH.yes : HLS_SWITCH.no)

/** A quoted attribute value has no escape in RFC 8216, so a quote or a line break cannot appear in one. */
const quoted = (value: string): string => `"${value.replace(/["\r\n]/g, '')}"`

const extinf = (seconds: number): string => `#EXTINF:${seconds.toFixed(3)},`

type CountedNameProps = {
  label: string
  taken: ReadonlySet<string>
  count: number
}

/** The label with the first count from `count` on that names nothing in `taken`. */
const countedName = ({ label, taken, count }: CountedNameProps): string => {
  const name = `${label} ${count}`
  return taken.has(name) ? countedName({ label, taken, count: count + 1 }) : name
}

/**
 * `NAME` must be unique within a group: a repeat of a label gets the first
 * count after it that is neither a name given yet nor another track's label.
 */
const uniqueNames = (labels: readonly string[]): string[] =>
  labels.reduce<string[]>(
    (names, label) => [
      ...names,
      names.includes(label)
        ? countedName({ label, taken: new Set([...labels, ...names]), count: 2 })
        : label,
    ],
    [],
  )

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
    `DEFAULT=${HLS_SWITCH.no}`,
    `AUTOSELECT=${yesNo(track.forced)}`,
    `FORCED=${yesNo(track.forced)}`,
    `URI=${quoted(uri)}`,
  ].join(',')

type MasterPlaylistProps = {
  mode: PlaybackMode
  variantUri: string
  subtitles: readonly SubtitleRendition[]
  codecs: string
  resolution: { width: number; height: number }
  bandwidth: number
}

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
}: MasterPlaylistProps): string => {
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

type MediaPlaylistProps = {
  plan: SegmentPlan
  initUri: string
  segmentUri: (n: number) => string
}

/** The video playlist: every segment of the plan, behind the init segment. */
export const mediaPlaylist = ({ plan, initUri, segmentUri }: MediaPlaylistProps): string => {
  const durations = segmentDurations(plan)
  return [
    '#EXTM3U',
    '#EXT-X-VERSION:7',
    '#EXT-X-PLAYLIST-TYPE:VOD',
    `#EXT-X-TARGETDURATION:${Math.ceil(durations.reduce((longest, seconds) => Math.max(longest, seconds), 0))}`,
    `#EXT-X-MAP:URI=${quoted(initUri)}`,
    ...durations.flatMap((seconds, n) => [extinf(seconds), segmentUri(n)]),
    '#EXT-X-ENDLIST',
    '',
  ].join('\n')
}

const SUBTITLE_SEGMENT_MS = HLS_SEGMENT_SECONDS * 1000

/** How many six-second WebVTT segments a subtitle playlist of `duration` seconds lists. */
export const subtitleSegmentCount = (duration: number): number =>
  Math.ceil(Math.round(duration * 1000) / SUBTITLE_SEGMENT_MS)

type SubtitlePlaylistProps = {
  duration: number
  segmentUri: (n: number) => string
}

/** A subtitle track's playlist: six-second WebVTT segments, the last one shorter. */
export const subtitlePlaylist = ({ duration, segmentUri }: SubtitlePlaylistProps): string => {
  const durationMs = Math.round(duration * 1000)
  return [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    '#EXT-X-PLAYLIST-TYPE:VOD',
    `#EXT-X-TARGETDURATION:${HLS_SEGMENT_SECONDS}`,
    ...Array.from({ length: subtitleSegmentCount(duration) }, (_, n) => [
      extinf(Math.min(SUBTITLE_SEGMENT_MS, durationMs - n * SUBTITLE_SEGMENT_MS) / 1000),
      segmentUri(n),
    ]).flat(),
    '#EXT-X-ENDLIST',
    '',
  ].join('\n')
}
