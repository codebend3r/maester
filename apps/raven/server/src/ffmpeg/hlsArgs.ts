import { join } from 'node:path'
import {
  type AudioTrack,
  HLS_COPY_AUDIO,
  HLS_COPY_AUDIO_CODECS,
  HLS_SEGMENT_SECONDS,
  PLAYBACK_MODES,
  STREAM_TIME_SHIFT,
  type StreamMode,
} from '@raven/core'
import {
  QUIET,
  type TranscodeQuality,
  VIDEO_STREAM,
  copyVideo,
  secondsArg,
  transcodeVideo,
} from '@/ffmpeg/args'
import type { VideoEncoder } from '@/ffmpeg/encoder'
import { type HlsDialect, SEGMENT_CLOCKS } from '@/ffmpeg/ffmpegVersion'
import { SEGMENT_FILE_PATTERN } from '@/hls/segmentFiles'
import { type SegmentPlan, runSegmentTimes } from '@/hls/segmentPlan'

/** E-AC-3 carries at most 5.1; a 7.1 track is folded down to it. */
const EAC3_MAX_CHANNELS = 6
const STEREO = 2

/** E-AC-3's bitrate for a channel count: 5.1, the layouts between stereo and it, and stereo or mono. */
const eac3Bitrate = (channels: number): string => {
  if (channels >= EAC3_MAX_CHANNELS) return '640k'
  if (channels > STEREO) return '448k'
  return '224k'
}

const copiedCodec = (track: Pick<AudioTrack, 'codec'>): string | null =>
  HLS_COPY_AUDIO.find((codec) => codec === track.codec) ?? null

/** The codec an HLS stream's audio comes out in, by ffprobe's name: E-AC-3 when it is not copied. */
export const hlsAudioCodec = (track: Pick<AudioTrack, 'codec'>): string =>
  copiedCodec(track) ?? HLS_COPY_AUDIO_CODECS.eac3

/**
 * How an HLS stream carries an audio track: copied when Apple's players and
 * ExoPlayer decode it in fMP4, else E-AC-3 keeping the channels it can.
 */
export const hlsAudioArgs = (track: Pick<AudioTrack, 'codec' | 'channels'>): string[] => {
  if (copiedCodec(track) != null) return ['-c:a', 'copy']
  const channels = Math.min(Math.max(track.channels ?? STEREO, 1), EAC3_MAX_CHANNELS)
  return [
    '-c:a',
    HLS_COPY_AUDIO_CODECS.eac3,
    '-ac',
    String(channels),
    '-b:a',
    eac3Bitrate(channels),
  ]
}

/**
 * The segment muxer's MP4 options. Without `frag_discont`, `use_editlist=0`
 * and its own `avoid_negative_ts=disabled`, every file's tfdt starts at zero:
 * the outer `-avoid_negative_ts` does not reach the inner muxer. Without
 * `delay_moov` an AC-3 or E-AC-3 track, copied or encoded, fails the run
 * ("Cannot write moov atom before AC3 packets"): its `dac3` box is read
 * from the first packet. It leaves an AAC run's bytes as they were.
 */
const SEGMENT_MP4_OPTIONS =
  'movflags=frag_keyframe+empty_moov+default_base_moof+frag_discont+delay_moov:use_editlist=0:avoid_negative_ts=disabled'

/** How far a remux's cut may sit from its boundary: the truncated keyframe times' error. */
const REMUX_CUT_TOLERANCE = 0.005

/** What every run of an HLS session reads and makes of it: the file, its plan, and how it is converted. */
export type HlsSource = {
  input: string
  mode: StreamMode
  plan: SegmentPlan
  /** Where the file's clock begins, `format.start_time`, which a transcode seeks from. */
  startTime: number
  /** The video's frame rate, whose frames a transcode's plan is on; null when unknown. */
  frameRate: number | null
  /** The track to play, or null when the file has no audio. */
  audio: AudioTrack | null
  videoCodec: string | null
  /** How a transcode encodes; a remux encodes nothing. */
  encoder: VideoEncoder
  maxHeight: number
  quality: TranscodeQuality
  /** A ceiling on the transcode's video bitrate, when the viewer asked for a size. */
  bitrate: number | null
  tonemap: boolean
}

/** How a run reads its file: the inputs, which one the audio comes from, and how it cuts. */
type RunCut = {
  inputs: string[]
  audioInput: number
  /** Where the video filter drops frames from, when the seek alone cannot. */
  trimFrom: number | null
  video: string[]
  tolerance: number
}

type RunCutProps = {
  source: HlsSource
  from: number
  seekKeyframes: readonly number[] | null
  timeBase: HlsDialect['timeBase']
}

/**
 * Where a run starts reading and how it cuts: a remux on its keyframes, a
 * transcode on the frame at each boundary.
 *
 * - A remux seeks with `-ss` read as a timestamp (`-seek_timestamp 1`), and
 *   `-copypriorss 0` drops what comes before it: with B-frames ffmpeg seeks
 *   3/23 s early, and a copy would keep the GOP before.
 * - A transcode's decoder drops the frames before `-ss` plus the file's
 *   start time, whatever `-seek_timestamp` says, so its `-ss` is counted
 *   from the start. Its frames keep their own timestamps
 *   (`-fps_mode passthrough` and the demuxer's time base) rather than
 *   moving onto a grid from 0, so they stay on the plan's frames, and every
 *   time it is given sits half a frame before its boundary, so it lands on
 *   that frame and on no other.
 * - MPEG-TS has no seek index, and ffmpeg indexes every packet of it as a
 *   keyframe, so a seek lands mid-GOP and the decoder starts at the next
 *   keyframe, which may be past the boundary. Given the file's keyframes, a
 *   transcode reads the video from just before the keyframe at or before
 *   the boundary and trims it there exactly, and reads the audio from a
 *   second input of the same file with the exact seek.
 */
const runCut = ({
  source: { input, mode, plan, startTime, frameRate },
  from,
  seekKeyframes,
  timeBase,
}: RunCutProps): RunCut => {
  const start = plan.boundaries[from] ?? 0
  const read = (seek: string[]): string[] => [...seek, '-copyts', '-i', input]
  if (mode === PLAYBACK_MODES.remux) {
    return {
      inputs: read(start > 0 ? ['-seek_timestamp', '1', '-ss', secondsArg(start)] : []),
      audioInput: 0,
      trimFrom: null,
      video: [],
      tolerance: REMUX_CUT_TOLERANCE,
    }
  }
  const tolerance = frameRate == null ? REMUX_CUT_TOLERANCE : 0.5 / frameRate
  // The seek counts from `format.start_time` as ffprobe read it, so ffprobe
  // and ffmpeg must agree on it (FfmpegService warns when they differ).
  const fromStart = (time: number): string[] =>
    time - startTime > 0 ? ['-ss', secondsArg(time - startTime)] : []
  const exact = fromStart(start - tolerance)
  const video = [
    '-fps_mode',
    'passthrough',
    '-enc_time_base',
    timeBase,
    '-force_key_frames',
    plan.boundaries
      .slice(from)
      .map((boundary) => secondsArg(boundary - tolerance))
      .join(','),
  ]
  if (seekKeyframes == null || exact.length === 0) {
    return { inputs: read(exact), audioInput: 0, trimFrom: null, video, tolerance }
  }
  const keyframe = seekKeyframes.findLast((time) => time <= start) ?? null
  return {
    inputs: [...read(keyframe == null ? [] : fromStart(keyframe - tolerance)), ...read(exact)],
    audioInput: 1,
    trimFrom: start - tolerance,
    video,
    tolerance,
  }
}

type HlsArgsProps = {
  source: HlsSource
  /** The segment the run starts at. */
  from: number
  folder: string
  /** The keyframes of a file whose seek lands mid-GOP (MPEG-TS), which a transcode seeks to; null for any other. */
  seekKeyframes: readonly number[] | null
  /** How this ffmpeg takes the version-dependent flags. */
  dialect: HlsDialect
}

/**
 * One HLS run: the plan's segments from `from` onwards, each a file of its
 * own in `folder`, on the file's own clock plus `STREAM_TIME_SHIFT`. A run
 * from any segment cuts exactly the segments a run from zero would, on
 * FFmpeg 5.1 to 9.0 (spec, "HLS muxing (2026-10-19)"):
 *
 * - The plan's times are the file's own pts, as ffprobe lists them, so the
 *   run keeps them: `-copyts` without `-start_at_zero`. `runCut` says how it
 *   seeks to its first boundary.
 * - `-segment_times` are indexed by the files this run wrote: the boundaries
 *   after `from`, as offsets from boundary `from` or as output timestamps by
 *   the dialect's segment clock, within `runCut`'s tolerance. The last
 *   segment gets a time past the end, since an empty list would fall back to
 *   the muxer's two-second timer.
 *
 * The muxer lists each file on stdout once it has closed it, which is how
 * the server knows a segment is whole.
 */
export const hlsArgs = ({
  source,
  from,
  folder,
  seekKeyframes,
  dialect,
}: HlsArgsProps): string[] => {
  const { plan, mode, audio } = source
  const start = plan.boundaries[from] ?? 0
  const offsets = runSegmentTimes({ plan, from })
  const past = offsets.length > 0 ? offsets : [plan.duration + HLS_SEGMENT_SECONDS]
  const times =
    dialect.segmentClock === SEGMENT_CLOCKS.run
      ? past
      : past.map((offset) => start + offset + STREAM_TIME_SHIFT)
  const cut = runCut({ source, from, seekKeyframes, timeBase: dialect.timeBase })
  const video =
    mode === PLAYBACK_MODES.remux
      ? copyVideo(source.videoCodec)
      : transcodeVideo({
          encoder: source.encoder,
          videoCodec: source.videoCodec,
          tonemap: source.tonemap,
          maxHeight: source.maxHeight,
          quality: source.quality,
          bitrate: source.bitrate,
          trimFrom: cut.trimFrom,
        })
  return [
    ...QUIET,
    ...video.input,
    ...cut.inputs,
    '-copypriorss',
    '0',
    '-map',
    VIDEO_STREAM,
    ...(audio == null ? [] : ['-map', `${cut.audioInput}:a:${audio.index}`]),
    ...video.output,
    ...cut.video,
    ...(audio == null ? [] : hlsAudioArgs(audio)),
    '-sn',
    '-dn',
    '-map_metadata',
    '-1',
    '-map_chapters',
    '-1',
    '-output_ts_offset',
    String(STREAM_TIME_SHIFT),
    '-avoid_negative_ts',
    'disabled',
    '-f',
    'segment',
    '-segment_format',
    'mp4',
    '-segment_format_options',
    SEGMENT_MP4_OPTIONS,
    '-segment_times',
    times.map(secondsArg).join(','),
    '-segment_time_delta',
    String(cut.tolerance),
    '-segment_start_number',
    String(from),
    '-segment_list',
    'pipe:1',
    '-segment_list_type',
    'flat',
    join(folder, SEGMENT_FILE_PATTERN),
  ]
}
