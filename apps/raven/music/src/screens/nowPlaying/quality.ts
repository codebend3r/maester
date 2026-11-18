import type { Track } from '@raven/core'
import { TRACK_STREAM_KINDS, type TrackStream } from '@raven/native/headless'

import { NOW_PLAYING_COPY } from '@/screens/copy'
import { factsLineOf } from '@/ui/counts'

const PER_KILO = 1000

/** A lossless file's resolution, "16-bit / 44.1 kHz"; null for a lossy one or one not read yet. */
const resolutionOf = ({ isLossless, bitDepth, sampleRate }: Track): string | null =>
  isLossless && bitDepth !== null && sampleRate !== null
    ? NOW_PLAYING_COPY.resolution({ bits: bitDepth, kilohertz: sampleRate / PER_KILO })
    : null

/** The file itself: "FLAC · 16-bit / 44.1 kHz · 912 kbps", each fact the server has not read left out. */
const fileLineOf = (track: Track): string =>
  factsLineOf([
    (track.codec ?? track.container).toUpperCase(),
    resolutionOf(track),
    track.bitrate === null ? null : NOW_PLAYING_COPY.kbps(Math.round(track.bitrate / PER_KILO)),
  ])

type QualityLineOfProps = { track: Track; stream: TrackStream }

/**
 * The format and quality of what is playing, which is not always the track's own file: the
 * file's codec, resolution and bitrate, the transcode's "AAC · 256 kbps", or the download's with
 * "Downloaded" after it.
 */
export const qualityLineOf = ({ track, stream }: QualityLineOfProps): string => {
  switch (stream.kind) {
    case TRACK_STREAM_KINDS.file:
      return fileLineOf(track)
    case TRACK_STREAM_KINDS.transcode:
      return factsLineOf([NOW_PLAYING_COPY.aac, NOW_PLAYING_COPY.kbps(stream.kbps)])
    case TRACK_STREAM_KINDS.download:
      return factsLineOf([
        NOW_PLAYING_COPY.aac,
        stream.kbps === null ? null : NOW_PLAYING_COPY.kbps(stream.kbps),
        NOW_PLAYING_COPY.downloaded,
      ])
    default: {
      const unreachable: never = stream
      return unreachable
    }
  }
}
