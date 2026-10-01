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
