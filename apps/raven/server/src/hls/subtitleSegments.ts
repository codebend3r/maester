import {
  HLS_SEGMENT_SECONDS,
  STREAM_TIME_SHIFT,
  SUBTITLE_SOURCES,
  type SubtitleCue,
  type SubtitleTrack,
  formatWebVtt,
  mergeCues,
  parseWebVtt,
  subtitleWindowOf,
} from '@raven/core'
import type { SegmentPlan } from '@/hls/segmentPlan'

/** The 90 kHz clock of MPEG-TS, which a WebVTT segment's `X-TIMESTAMP-MAP` ties its cues to. */
const MPEG_TS_HZ = 90_000

type Span = { from: number; to: number }

/**
 * The stretch subtitle segment `n` covers, on the file's own clock: the
 * playlists start where the video's first segment does.
 */
export const subtitleSpanOf = ({ plan, n }: { plan: SegmentPlan; n: number }): Span => {
  const from = (plan.boundaries[0] ?? 0) + n * HLS_SEGMENT_SECONDS
  return { from, to: from + HLS_SEGMENT_SECONDS }
}

/**
 * The windows of the track's WebVTT the span's cues are in: an embedded
 * track's are timed from the file's start, and a sidecar is one whole file.
 */
export const subtitleWindowsOf = ({
  track,
  span,
  startTime,
}: {
  track: SubtitleTrack
  span: Span
  startTime: number
}): number[] => {
  if (track.source === SUBTITLE_SOURCES.external) return [0]
  const first = subtitleWindowOf(span.from - startTime)
  const last = subtitleWindowOf(span.to - startTime)
  return Array.from({ length: last - first + 1 }, (_, k) => first + k)
}

/**
 * The cues of those windows showing in the span, as one WebVTT segment.
 * They are timed from the file's start, so each is moved onto the file's
 * own clock, which the video keeps, and the header ties that clock, shifted
 * by `STREAM_TIME_SHIFT`, to the video's.
 */
export const subtitleSegmentVtt = ({
  texts,
  span,
  startTime,
}: {
  texts: readonly string[]
  span: Span
  startTime: number
}): string => {
  const cues = texts
    .map(parseWebVtt)
    .reduce<SubtitleCue[]>((existing, incoming) => mergeCues({ existing, incoming }), [])
    .map((cue) => ({ start: cue.start + startTime, end: cue.end + startTime, text: cue.text }))
    .filter((cue) => cue.end > span.from && cue.start < span.to)
  return formatWebVtt({
    cues,
    timestampMap: { mpegts: STREAM_TIME_SHIFT * MPEG_TS_HZ, local: 0 },
  })
}
