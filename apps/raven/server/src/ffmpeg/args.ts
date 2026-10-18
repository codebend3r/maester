import { ENCODER_KINDS, PLAYBACK_MODES, type StreamMode } from '@raven/core'
import { SOFTWARE, type VideoEncoder } from '@/ffmpeg/encoder'

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

/** The scale filter that caps a transcode at `maxHeight` lines without ever upscaling. */
const scaleTo = (maxHeight: number): string => `w=-2:h='min(${maxHeight},ih)'`

export type TranscodeQuality = 'low' | 'medium' | 'high'

/** How hard each encoder squeezes at each quality: a CRF or QP, and a bitrate for VideoToolbox. */
const QUALITY: Record<TranscodeQuality, { crf: string; qp: string; bitrate: string }> = {
  low: { crf: '28', qp: '28', bitrate: '4M' },
  medium: { crf: '23', qp: '23', bitrate: '8M' },
  high: { crf: '18', qp: '18', bitrate: '16M' },
}

/** ffprobe's `codec_name` for the codecs the args treat apart. */
const VIDEO_CODECS = { h264: 'h264', hevc: 'hevc' } as const

/** Codecs every Intel GPU recent enough for VAAPI decodes; anything else decodes on the CPU. */
const GPU_DECODES: ReadonlySet<string> = new Set([VIDEO_CODECS.h264, VIDEO_CODECS.hevc])

/**
 * A size the viewer asked for is a ceiling, and an encoder's own target only
 * averages to it: a 2 second buffer lets scenes peak but not past it.
 */
const ceiling = (bitrate: number | null): string[] =>
  bitrate == null ? [] : ['-maxrate', String(bitrate), '-bufsize', String(bitrate * 2)]

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
}: {
  encoder: VideoEncoder
  videoCodec: string | null
  tonemap: boolean
  maxHeight: number
  quality: TranscodeQuality
  bitrate: number | null
}): { input: string[]; output: string[] } => {
  const scale = scaleTo(maxHeight)
  const squeeze = QUALITY[quality]
  const cpuFilters = [`scale=${scale}`, ...(tonemap ? [TONEMAP_FILTER] : [])]
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
        bitrate == null ? squeeze.bitrate : String(bitrate),
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
      ? [`scale_vaapi=${scale}:format=nv12${toBt709}`]
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
      ? // Safari only plays HEVC in MP4 under the hvc1 tag.
        {
          input: [],
          output: ['-c:v', 'copy', ...(videoCodec === VIDEO_CODECS.hevc ? ['-tag:v', 'hvc1'] : [])],
        }
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
