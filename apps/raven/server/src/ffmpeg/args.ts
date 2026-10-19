import { join } from 'node:path'
import {
  type AudioTrack,
  ENCODER_KINDS,
  HLS_COPY_AUDIO,
  HLS_COPY_AUDIO_CODECS,
  HLS_SEGMENT_SECONDS,
  PLAYBACK_MODES,
  STREAM_TIME_SHIFT,
  type StreamMode,
} from '@raven/core'
import { SOFTWARE, type VideoEncoder } from '@/ffmpeg/encoder'
import { SEGMENT_FILE_PATTERN } from '@/hls/segmentFiles'
import { type SegmentPlan, runSegmentTimes } from '@/hls/segmentPlan'

const QUIET = ['-hide_banner', '-loglevel', 'error', '-nostdin']

/**
 * PQ or HLG down to SDR BT.709, so an HDR frame does not come out grey and
 * washed out. Needs ffmpeg built with zimg (`zscale`), which Debian's ffmpeg
 * and jellyfin-ffmpeg both are and Homebrew's is not; the caller checks.
 */
export const TONEMAP_FILTER = [
  'zscale=t=linear:npl=100',
  'format=gbrpf32le',
  'zscale=p=bt709',
  'tonemap=tonemap=hable:desat=0',
  'zscale=t=bt709:m=bt709:r=tv',
  'format=yuv420p',
].join(',')

/**
 * Where to grab a thumbnail from: a tenth of the way in skips studio logos
 * and cold opens without landing in the credits. Very short clips use the
 * first frame.
 */
export const thumbnailSeek = (duration: number | null): number =>
  duration == null || duration < 4 ? 0 : Math.round(duration * 0.1 * 1000) / 1000

/**
 * One JPEG from a video. `-ss` goes before `-i` so ffmpeg jumps straight to
 * the nearest keyframe through the container index instead of decoding
 * everything up to the timestamp: 0.3s against 7.5s for a 1080p HEVC file
 * over SMB. The `thumbnail` filter then picks the most representative of the
 * next 24 frames, which steers clear of fades to black.
 */
export const thumbnailArgs = ({
  input,
  output,
  seek,
  width,
  tonemap,
}: {
  input: string
  output: string
  seek: number
  width: number
  tonemap: boolean
}): string[] => [
  ...QUIET,
  '-y',
  ...(seek > 0 ? ['-ss', String(seek)] : []),
  '-i',
  input,
  '-map',
  '0:v:0',
  '-an',
  '-sn',
  '-dn',
  '-frames:v',
  '1',
  '-vf',
  ['thumbnail=n=24', `scale=w=${width}:h=-2`, ...(tonemap ? [TONEMAP_FILTER] : [])].join(','),
  '-q:v',
  '4',
  output,
]

/** Seconds as ffmpeg's arguments take them, to the millisecond like the plan. */
const secondsArg = (seconds: number): string => seconds.toFixed(3)

/** The scale filter that caps a transcode at `maxHeight` lines without ever upscaling. */
const scaleTo = (maxHeight: number): string => `w=-2:h='min(${maxHeight},ih)'`

export type TranscodeQuality = 'low' | 'medium' | 'high'

/**
 * How hard each encoder squeezes at each quality: a CRF or QP, and a
 * bitrate in bits per second for VideoToolbox.
 */
const QUALITY: Record<TranscodeQuality, { crf: string; qp: string; bitrate: number }> = {
  low: { crf: '28', qp: '28', bitrate: 4_000_000 },
  medium: { crf: '23', qp: '23', bitrate: 8_000_000 },
  high: { crf: '18', qp: '18', bitrate: 16_000_000 },
}

/**
 * The video bitrate a transcode aims for: the viewer's ceiling when they
 * asked for a size, else VideoToolbox's target for the quality setting,
 * which the CRF of the other encoders lands near.
 */
export const transcodeBitrate = ({
  quality,
  bitrate,
}: {
  quality: TranscodeQuality
  bitrate: number | null
}): number => bitrate ?? QUALITY[quality].bitrate

/** ffprobe's `codec_name` for the codecs the args treat apart. */
export const VIDEO_CODECS = { h264: 'h264', hevc: 'hevc' } as const

/** Codecs every Intel GPU recent enough for VAAPI decodes; anything else decodes on the CPU. */
const GPU_DECODES: ReadonlySet<string> = new Set([VIDEO_CODECS.h264, VIDEO_CODECS.hevc])

/**
 * A size the viewer asked for is a ceiling, and an encoder's own target only
 * averages to it: a 2 second buffer lets scenes peak but not past it.
 */
const ceiling = (bitrate: number | null): string[] =>
  bitrate == null ? [] : ['-maxrate', String(bitrate), '-bufsize', String(bitrate * 2)]

/** Video flags: those before `-i`, and the encoding after it. */
type VideoArgs = { input: string[]; output: string[] }

/** A remux's video, copied. Safari and AVPlayer only play HEVC in MP4 under the hvc1 tag. */
const copyVideo = (videoCodec: string | null): VideoArgs => ({
  input: [],
  output: ['-c:v', 'copy', ...(videoCodec === VIDEO_CODECS.hevc ? ['-tag:v', 'hvc1'] : [])],
})

/**
 * The flags before `-i` and the video encoding after it, for a transcode.
 *
 * - Software: libx264 on the CPU, as fast as quality allows.
 * - VideoToolbox: the Mac's media engine decodes (HEVC included) and encodes.
 * - VAAPI: an H.264 or HEVC file stays on the GPU from decode through scale
 *   to encode. HDR stays there too, its colours converted to BT.709 instead
 *   of tone mapped: a NAS-class CPU tone maps 1080p at about 1.6 fps (seen
 *   on a Celeron J4125), and the GPU's own tone mapper takes HDR10 only. HLG,
 *   what phones record, is made to look right on SDR screens without it.
 *   Anything else decodes on the CPU and is uploaded for the encoder.
 */
const transcodeVideo = ({
  encoder,
  videoCodec,
  tonemap,
  maxHeight,
  quality,
  bitrate,
  trimFrom = null,
}: {
  encoder: VideoEncoder
  videoCodec: string | null
  tonemap: boolean
  maxHeight: number
  quality: TranscodeQuality
  bitrate: number | null
  /** Drops the frames before this time, on the file's clock, before any other filter. */
  trimFrom?: number | null
}): VideoArgs => {
  const scale = scaleTo(maxHeight)
  const squeeze = QUALITY[quality]
  const trim = trimFrom == null ? [] : [`trim=start=${secondsArg(trimFrom)}`]
  const cpuFilters = [...trim, `scale=${scale}`, ...(tonemap ? [TONEMAP_FILTER] : [])]
  // A keyframe every two seconds keeps fragments small, so playback starts
  // and seeks quickly.
  const shared = ['-profile:v', 'high', '-g', '48']

  if (encoder.kind === ENCODER_KINDS.videotoolbox) {
    return {
      input: ['-hwaccel', 'videotoolbox'],
      output: [
        '-c:v',
        'h264_videotoolbox',
        '-b:v',
        String(transcodeBitrate({ quality, bitrate })),
        ...ceiling(bitrate),
        ...shared,
        '-pix_fmt',
        'yuv420p',
        '-vf',
        cpuFilters.join(','),
      ],
    }
  }

  if (encoder.kind === ENCODER_KINDS.vaapi) {
    const device = ['-init_hw_device', `vaapi=va:${encoder.device}`, '-filter_hw_device', 'va']
    const gpuDecode = videoCodec != null && GPU_DECODES.has(videoCodec)
    const toBt709 = tonemap
      ? ':out_color_matrix=bt709:out_color_primaries=bt709:out_color_transfer=bt709:out_range=tv'
      : ''
    const filters = gpuDecode
      ? [...trim, `scale_vaapi=${scale}:format=nv12${toBt709}`]
      : [...cpuFilters, 'format=nv12', 'hwupload']
    return {
      input: [
        ...device,
        ...(gpuDecode
          ? ['-hwaccel', 'vaapi', '-hwaccel_device', 'va', '-hwaccel_output_format', 'vaapi']
          : []),
      ],
      output: [
        '-c:v',
        'h264_vaapi',
        ...(bitrate == null ? ['-qp', squeeze.qp] : ['-b:v', String(bitrate), ...ceiling(bitrate)]),
        ...shared,
        '-vf',
        filters.join(','),
      ],
    }
  }

  return {
    input: [],
    output: [
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      squeeze.crf,
      ...ceiling(bitrate),
      ...shared,
      '-pix_fmt',
      'yuv420p',
      '-vf',
      cpuFilters.join(','),
    ],
  }
}

/**
 * A short encode from a generated test pattern, to find out whether an
 * encoder really works here: an encoder can be compiled in while the GPU,
 * its driver or the device permissions are missing.
 */
export const encoderTestArgs = (encoder: VideoEncoder): string[] => {
  const { input, output } = transcodeVideo({
    encoder,
    videoCodec: null,
    tonemap: false,
    maxHeight: 1080,
    quality: 'medium',
    bitrate: null,
  })
  return [
    ...QUIET,
    ...input,
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=640x360:rate=24:duration=0.5',
    ...output,
    '-f',
    'null',
    '-',
  ]
}

/**
 * A converted stream: fragmented MP4 on stdout, fed to the browser through
 * Media Source Extensions. The stream keeps the file's own clock
 * (`-copyts -start_at_zero`, `frag_discont`, no edit list), shifted by
 * `streamShift` so no timestamp goes negative, which lets the player put
 * every fragment where it belongs whatever point the stream started from.
 *
 * `remux` copies the video and converts only the audio, which costs little
 * more than reading the file. `transcode` re-encodes the video to H.264 as
 * well, at most 1080p, tone mapped when the source is HDR and ffmpeg can.
 */
export const streamArgs = ({
  input,
  start,
  mode,
  audio,
  videoCodec,
  tonemap,
  streamShift,
  encoder = SOFTWARE,
  maxHeight = 1080,
  quality = 'medium',
  bitrate = null,
}: {
  input: string
  start: number
  mode: StreamMode
  /** The `0:a:N` track to play, or null when the file has no audio. */
  audio: number | null
  videoCodec: string | null
  tonemap: boolean
  streamShift: number
  /** How a transcode encodes; a remux encodes nothing. */
  encoder?: VideoEncoder
  /** The frame a transcode is scaled down to, and how hard it is squeezed: the playback settings. */
  maxHeight?: number
  quality?: TranscodeQuality
  /** A ceiling on the transcode's video bitrate in bits per second, when the viewer asked for a size. */
  bitrate?: number | null
}): string[] => {
  const video =
    mode === PLAYBACK_MODES.remux
      ? copyVideo(videoCodec)
      : transcodeVideo({ encoder, videoCodec, tonemap, maxHeight, quality, bitrate })
  return [
    ...QUIET,
    ...video.input,
    ...(start > 0 ? ['-ss', String(start)] : []),
    '-copyts',
    '-start_at_zero',
    '-i',
    input,
    '-map',
    '0:v:0',
    ...(audio == null ? [] : ['-map', `0:a:${audio}`]),
    ...video.output,
    ...(audio == null ? [] : ['-c:a', 'aac', '-ac', '2', '-b:a', '192k']),
    '-sn',
    '-dn',
    '-map_metadata',
    '-1',
    '-map_chapters',
    '-1',
    '-max_muxing_queue_size',
    '4096',
    '-output_ts_offset',
    String(streamShift),
    '-avoid_negative_ts',
    'disabled',
    '-use_editlist',
    '0',
    '-f',
    'mp4',
    '-movflags',
    'frag_keyframe+empty_moov+default_base_moof+frag_discont',
    // A remux cannot shorten the source GOP. Flush at least every second
    // even between keyframes so slow reads do not hold several seconds of A/V.
    '-frag_duration',
    '1000000',
    'pipe:1',
  ]
}

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

/**
 * How the segment muxer reads `-segment_times`. From FFmpeg 6.0 it adds the
 * run's first video pts to each, so they are offsets from the run's start;
 * before, as in Debian 12's 5.1 that the server image ships, they are output
 * timestamps.
 */
export const SEGMENT_CLOCKS = { run: 'run', output: 'output' } as const

export type SegmentClock = (typeof SEGMENT_CLOCKS)[keyof typeof SEGMENT_CLOCKS]

const RUN_RELATIVE_SINCE = 6

/** The segment clock of the ffmpeg whose `-version` line this is; a build without a release number is new. */
export const segmentClockOf = (version: string | null): SegmentClock => {
  const major = /^ffmpeg version n?(\d+)\./.exec(version ?? '')?.[1]
  return major != null && Number(major) < RUN_RELATIVE_SINCE
    ? SEGMENT_CLOCKS.output
    : SEGMENT_CLOCKS.run
}

/** How far a remux's cut may sit from its boundary: the truncated keyframe times' error. */
const REMUX_CUT_TOLERANCE = 0.005

/**
 * How `-enc_time_base` names the demuxer's time base: `demux` from FFmpeg
 * 6.1, `-1` before it. 6.0 refuses `demux`, and 9.0 refuses `-1`.
 */
export const DEMUX_TIME_BASES = { named: 'demux', numbered: '-1' } as const

export type DemuxTimeBase = (typeof DEMUX_TIME_BASES)[keyof typeof DEMUX_TIME_BASES]

const NAMED_TIME_BASE_SINCE = { major: 6, minor: 1 } as const

/** The demuxer's time base by the name the ffmpeg whose `-version` line this is takes; a build without a release number is new. */
export const demuxTimeBaseOf = (version: string | null): DemuxTimeBase => {
  const match = /^ffmpeg version n?(\d+)\.(\d+)/.exec(version ?? '')
  if (!match) return DEMUX_TIME_BASES.named
  const [major, minor] = [Number(match[1]), Number(match[2])]
  const isOlder =
    major < NAMED_TIME_BASE_SINCE.major ||
    (major === NAMED_TIME_BASE_SINCE.major && minor < NAMED_TIME_BASE_SINCE.minor)
  return isOlder ? DEMUX_TIME_BASES.numbered : DEMUX_TIME_BASES.named
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
  input,
  mode,
  plan,
  from,
  startTime,
  frameRate,
  seekKeyframes,
  timeBase,
}: {
  input: string
  mode: StreamMode
  plan: SegmentPlan
  from: number
  startTime: number
  frameRate: number | null
  seekKeyframes: readonly number[] | null
  timeBase: DemuxTimeBase
}): RunCut => {
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
 *   `segmentClock`, within `runCut`'s tolerance. The last segment gets a
 *   time past the end, since an empty list would fall back to the muxer's
 *   two-second timer.
 *
 * The muxer lists each file on stdout once it has closed it, which is how
 * the server knows a segment is whole.
 */
export const hlsArgs = ({
  input,
  plan,
  from,
  mode,
  audio,
  videoCodec,
  encoder,
  maxHeight,
  quality,
  bitrate,
  tonemap,
  startTime,
  frameRate,
  seekKeyframes,
  folder,
  segmentClock,
  timeBase,
}: {
  input: string
  plan: SegmentPlan
  /** The segment the run starts at. */
  from: number
  mode: StreamMode
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
  /** Where the file's clock begins, `format.start_time`, which a transcode seeks from. */
  startTime: number
  /** The video's frame rate, whose frames a transcode's plan is on; null when unknown. */
  frameRate: number | null
  /** The keyframes of a file whose seek lands mid-GOP (MPEG-TS), which a transcode seeks to; null for any other. */
  seekKeyframes: readonly number[] | null
  folder: string
  segmentClock: SegmentClock
  /** How this ffmpeg names the demuxer's time base. */
  timeBase: DemuxTimeBase
}): string[] => {
  const start = plan.boundaries[from] ?? 0
  const offsets = runSegmentTimes({ plan, from })
  const past = offsets.length > 0 ? offsets : [plan.duration + HLS_SEGMENT_SECONDS]
  const times =
    segmentClock === SEGMENT_CLOCKS.run
      ? past
      : past.map((offset) => start + offset + STREAM_TIME_SHIFT)
  const cut = runCut({ input, mode, plan, from, startTime, frameRate, seekKeyframes, timeBase })
  const video =
    mode === PLAYBACK_MODES.remux
      ? copyVideo(videoCodec)
      : transcodeVideo({
          encoder,
          videoCodec,
          tonemap,
          maxHeight,
          quality,
          bitrate,
          trimFrom: cut.trimFrom,
        })
  return [
    ...QUIET,
    ...video.input,
    ...cut.inputs,
    '-copypriorss',
    '0',
    '-map',
    '0:v:0',
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

/**
 * One window of an embedded subtitle track as WebVTT. Reads only the
 * window's stretch of the file and keeps cue times as file times.
 */
/**
 * One window of an embedded track as WebVTT. `-ss` before the input seeks
 * through the container index; `-copyts` keeps the cues on the file's
 * clock; and the end is `-to` on the output, an absolute position. A
 * duration before the input does not stop a subtitle-only read: ffmpeg
 * went on to the end of a 74 GB file, 160 seconds for one minute of cues,
 * where `-to` takes under two.
 */
export const subtitleWindowArgs = ({
  input,
  stream,
  start,
  duration,
  output,
}: {
  input: string
  /** The `0:s:N` track. */
  stream: number
  start: number
  duration: number
  output: string
}): string[] => [
  ...QUIET,
  '-y',
  ...(start > 0 ? ['-ss', String(start)] : []),
  '-copyts',
  '-start_at_zero',
  '-i',
  input,
  '-map',
  `0:s:${stream}`,
  '-to',
  String(start + duration),
  '-f',
  'webvtt',
  output,
]

/** A whole sidecar subtitle file as WebVTT, read as `charset` when given. */
export const subtitleFileArgs = ({
  input,
  output,
  charset,
}: {
  input: string
  output: string
  charset: string | null
}): string[] => [
  ...QUIET,
  '-y',
  ...(charset == null ? [] : ['-sub_charenc', charset]),
  '-i',
  input,
  '-f',
  'webvtt',
  output,
]

/**
 * A poster or backdrop beside the media, scaled down to `width` (never up)
 * and saved as a JPEG for the image cache. The original is only read.
 */
export const imageScaleArgs = ({
  input,
  output,
  width,
}: {
  input: string
  output: string
  width: number
}): string[] => [
  ...QUIET,
  '-y',
  '-i',
  input,
  '-frames:v',
  '1',
  '-vf',
  `scale=w='min(${width},iw)':h=-2`,
  '-q:v',
  '3',
  output,
]
