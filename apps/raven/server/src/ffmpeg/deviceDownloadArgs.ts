import { AUDIO_CODECS, type AudioTrack, type DolbyVisionConfig } from '@raven/core'
import { QUIET, copyVideo, eac3OrCopyArgs } from '@/ffmpeg/args'
import { MP4_TEXT_SUBTITLE } from '@/ffmpeg/tracks'

/** ffprobe's names for the audio codecs AVPlayer plays from an MP4 as they are; any other becomes E-AC-3. */
const MP4_COPY_AUDIO = [
  AUDIO_CODECS.aac,
  AUDIO_CODECS.ac3,
  AUDIO_CODECS.eac3,
  AUDIO_CODECS.mp3,
] as const

/** Where ffmpeg writes its `key=value` progress lines: stdout, read as the run goes. */
const PROGRESS_TO_STDOUT = 'pipe:1'

/** Each audio track by its own output stream, since the copy carries them all. */
const audioArgs = (track: AudioTrack): string[] =>
  eac3OrCopyArgs({ track, copies: MP4_COPY_AUDIO, stream: track.index })

export type FinishedMp4ArgsProps = {
  output: string
  /** The `0:s:N` text subtitle tracks the run mapped, which the file carries as `mov_text`. */
  textSubtitles: readonly number[]
}

/** The `-map` of each text subtitle track a download copy carries. */
export const textSubtitleMaps = (textSubtitles: readonly number[]): string[] =>
  textSubtitles.flatMap((at) => ['-map', `0:s:${at}`])

/**
 * How every download copy ends: its text subtitles as `mov_text`, the languages, titles and
 * chapters kept, the index first so the finished file opens at once, and ffmpeg's progress
 * on stdout.
 */
export const finishedMp4Args = ({ output, textSubtitles }: FinishedMp4ArgsProps): string[] => [
  ...(textSubtitles.length > 0 ? ['-c:s', MP4_TEXT_SUBTITLE] : []),
  '-map_metadata',
  '0',
  '-map_chapters',
  '0',
  // A long film with sparse subtitles queues many packets before the first cue.
  '-max_muxing_queue_size',
  '4096',
  '-movflags',
  '+faststart',
  '-progress',
  PROGRESS_TO_STDOUT,
  '-nostats',
  '-f',
  'mp4',
  output,
]

type DeviceDownloadArgsProps = {
  input: string
  output: string
  videoCodec: string | null
  /** The picture's Dolby Vision configuration, kept in the copy; null for a picture without one. */
  dolbyVision: DolbyVisionConfig | null
  audio: readonly AudioTrack[]
  /** The `0:s:N` text subtitle tracks to carry as `mov_text`; picture ones are never listed. */
  textSubtitles: readonly number[]
}

/**
 * A video as an MP4 AVPlayer plays: its picture copied (HEVC under the hvc1 tag, Dolby
 * Vision HEVC under dvh1 with its configuration box), every
 * audio track copied when AVPlayer plays its codec and converted to E-AC-3 when it does
 * not, the text subtitles as `mov_text`, the languages, titles and chapters kept, and the
 * index first so the finished file opens at once. ffmpeg reports how far it got on stdout.
 */
export const deviceDownloadArgs = ({
  input,
  output,
  videoCodec,
  dolbyVision,
  audio,
  textSubtitles,
}: DeviceDownloadArgsProps): string[] => {
  const video = copyVideo({ videoCodec, dolbyVision })
  return [
    ...QUIET,
    '-y',
    '-i',
    input,
    '-map',
    video.map,
    '-map',
    '0:a?',
    ...textSubtitleMaps(textSubtitles),
    ...video.output,
    ...audio.flatMap(audioArgs),
    ...finishedMp4Args({ output, textSubtitles }),
  ]
}

/** The `out_time_us` ffmpeg's `-progress` prints, the microseconds of the file it has written. */
const OUT_TIME = /out_time_us=(\d+)/g

/** How many seconds of the file the last `-progress` block in `text` says are written, or null when none says. */
export const progressSeconds = (text: string): number | null => {
  const last = [...text.matchAll(OUT_TIME)].at(-1)?.[1] ?? null
  return last === null ? null : Number(last) / 1_000_000
}
