import type { Track } from '@/contract/music'
import { formatSampleRate } from '@/format'
import { TRACK_STREAM_KINDS, type TrackStream } from '@/trackStream'

const PER_KILO = 1000

/** The format a transcode and a download play in. */
const TRANSCODE_FORMAT = 'AAC'

/** The words the quality line says, in every app. */
const AUDIO_QUALITY_COPY = {
  downloaded: 'Downloaded',
  /** A lossless file's bit depth: "16-bit". */
  bitDepth: (bits: number) => `${bits}-bit`,
  /** A bitrate: "912 kbps". */
  kbps: (kbps: number) => `${kbps} kbps`,
} as const

/**
 * The format and quality of what is playing, each fact in words: the format and a lossless
 * file's bit depth, which a player shows as chips, then the sample rate and the bitrate. A fact
 * the server has not read, or that the stream does not have, is null.
 */
export type AudioQuality = {
  /** "FLAC", "MP3", "AAC". */
  format: string
  /** "16-bit", "24-bit"; a lossless file's alone. */
  bitDepth: string | null
  /** "44.1 kHz"; a lossless file's alone. */
  sampleRate: string | null
  /** "912 kbps". */
  bitrate: string | null
  /** Whether it plays from a download, not from the server. */
  isDownloaded: boolean
}

const kbpsOf = (kbps: number | null): string | null =>
  kbps === null ? null : AUDIO_QUALITY_COPY.kbps(kbps)

/** The file itself: its codec, its resolution when it is lossless, and its bitrate. */
const fileQualityOf = (track: Track): AudioQuality => ({
  format: (track.codec ?? track.container).toUpperCase(),
  bitDepth:
    track.isLossless && track.bitDepth !== null
      ? AUDIO_QUALITY_COPY.bitDepth(track.bitDepth)
      : null,
  sampleRate: track.isLossless ? formatSampleRate(track.sampleRate) : null,
  bitrate: kbpsOf(track.bitrate === null ? null : Math.round(track.bitrate / PER_KILO)),
  isDownloaded: false,
})

type AudioQualityOfProps = { track: Track; stream: TrackStream }

/**
 * The quality of what is playing, which is not always the track's own file: the file's codec,
 * resolution and bitrate, the transcode's AAC at its bitrate, or the download's.
 */
export const audioQualityOf = ({ track, stream }: AudioQualityOfProps): AudioQuality => {
  switch (stream.kind) {
    case TRACK_STREAM_KINDS.file:
      return fileQualityOf(track)
    case TRACK_STREAM_KINDS.transcode:
    case TRACK_STREAM_KINDS.download:
      return {
        format: TRANSCODE_FORMAT,
        bitDepth: null,
        sampleRate: null,
        bitrate: kbpsOf(stream.kbps),
        isDownloaded: stream.kind === TRACK_STREAM_KINDS.download,
      }
    default: {
      const unreachable: never = stream
      return unreachable
    }
  }
}

/** The facts a player shows as chips: the format, then the bit depth when there is one. */
export const qualityChipsOf = ({ format, bitDepth }: AudioQuality): string[] =>
  bitDepth === null ? [format] : [format, bitDepth]

/** What follows the chips, in order: the sample rate, the bitrate, and "Downloaded" for a download. */
export const qualityRestOf = ({ sampleRate, bitrate, isDownloaded }: AudioQuality): string[] =>
  [sampleRate, bitrate, isDownloaded ? AUDIO_QUALITY_COPY.downloaded : null].flatMap((fact) =>
    fact === null ? [] : [fact],
  )
