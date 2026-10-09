import type { StreamMode } from '@raven/core'

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
}: {
  input: string
  start: number
  mode: StreamMode
  /** The `0:a:N` track to play, or null when the file has no audio. */
  audio: number | null
  videoCodec: string | null
  tonemap: boolean
  streamShift: number
}): string[] => [
  ...QUIET,
  ...(start > 0 ? ['-ss', String(start)] : []),
  '-copyts',
  '-start_at_zero',
  '-i',
  input,
  '-map',
  '0:v:0',
  ...(audio == null ? [] : ['-map', `0:a:${audio}`]),
  ...(mode === 'remux'
    ? // Safari only plays HEVC in MP4 under the hvc1 tag.
      ['-c:v', 'copy', ...(videoCodec === 'hevc' ? ['-tag:v', 'hvc1'] : [])]
    : [
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '23',
        '-profile:v',
        'high',
        '-pix_fmt',
        'yuv420p',
        // A keyframe every two seconds keeps fragments small, so playback
        // starts and seeks quickly.
        '-g',
        '48',
        '-vf',
        ["scale=w=-2:h='min(1080,ih)'", ...(tonemap ? [TONEMAP_FILTER] : [])].join(','),
      ]),
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
  'pipe:1',
]

/**
 * One window of an embedded subtitle track as WebVTT. Reads only the
 * window's stretch of the file and keeps cue times as file times.
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
  '-t',
  String(duration),
  '-copyts',
  '-start_at_zero',
  '-i',
  input,
  '-map',
  `0:s:${stream}`,
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
