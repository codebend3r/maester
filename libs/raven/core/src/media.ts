/** What a library holds: videos, or audio files. Its type decides which. */
export const MEDIA_TYPES = { video: 'video', audio: 'audio' } as const

export type MediaType = (typeof MEDIA_TYPES)[keyof typeof MEDIA_TYPES]

/** Extensions the scanner indexes in a video library. Anything else under a library path is ignored. */
export const VIDEO_EXTENSIONS: readonly string[] = [
  '3gp',
  'avi',
  'flv',
  'm2ts',
  'm4v',
  'mkv',
  'mov',
  'mp4',
  'mpeg',
  'mpg',
  'mts',
  'ogv',
  'ts',
  'webm',
  'wmv',
]

/** Extensions the scanner indexes in an audio library. */
const AUDIO_EXTENSIONS: readonly string[] = [
  'aac',
  'aif',
  'aiff',
  'ape',
  'dsf',
  'flac',
  'm4a',
  'm4b',
  'mp3',
  'oga',
  'ogg',
  'opus',
  'wav',
  'wv',
]

/** The extensions each type of media is indexed by. */
export const MEDIA_EXTENSIONS = {
  [MEDIA_TYPES.video]: VIDEO_EXTENSIONS,
  [MEDIA_TYPES.audio]: AUDIO_EXTENSIONS,
} as const satisfies Record<MediaType, readonly string[]>

/** The lowercased extension without its dot, or '' when the name has none. */
export const extensionOf = (fileName: string): string => {
  const dot = fileName.lastIndexOf('.')
  return dot > 0 ? fileName.slice(dot + 1).toLowerCase() : ''
}

export const isVideoFile = (fileName: string): boolean =>
  VIDEO_EXTENSIONS.includes(extensionOf(fileName))

/** Whether a container, as `containerOf` names it, is an audio file's. */
export const isAudioContainer = (container: string): boolean => AUDIO_EXTENSIONS.includes(container)

/**
 * The container a file is played back as. Taken from the extension rather
 * than ffprobe's `format_name`, which reports 'matroska,webm' for both .mkv
 * and .webm and 'mov,mp4,m4a,3gp,3g2,mj2' for every ISO-BMFF file, when
 * browsers treat those very differently.
 */
export const containerOf = (fileName: string): string => {
  const extension = extensionOf(fileName)
  const aliases: Record<string, string> = {
    m4v: 'mp4',
    mpeg: 'mpg',
    mts: 'm2ts',
    m4b: 'm4a',
    oga: 'ogg',
    aif: 'aiff',
  }
  return aliases[extension] ?? extension
}

/**
 * A readable title from a file name: the extension goes, and scene-style
 * dot or underscore separators become spaces when the name has no spaces of
 * its own. "The.Matrix.1999.1080p.mkv" reads "The Matrix 1999 1080p", while
 * "Busboys (2026) 1080p WEBRip.mkv" keeps its own spacing.
 */
export const titleFromFileName = (fileName: string): string => {
  const dot = fileName.lastIndexOf('.')
  const stem = dot > 0 ? fileName.slice(0, dot) : fileName
  const spaced = stem.includes(' ') ? stem : stem.replace(/[._]+/g, ' ')
  return spaced.trim() || fileName
}

/** The resolutions `resolutionLabel` names, from the least to the most. */
export const RESOLUTIONS = {
  sd: 'SD',
  p320: '320p',
  p480: '480p',
  p720: '720p',
  p1080: '1080p',
  uhd: '4K',
  uhd8k: '8K',
} as const

export type Resolution = (typeof RESOLUTIONS)[keyof typeof RESOLUTIONS]

type ResolutionLabelProps = {
  width: number | null
  height: number | null
}

/** "8K", "4K", "1080p", "720p", "480p", "320p" or "SD", from the frame size. */
export const resolutionLabel = ({ width, height }: ResolutionLabelProps): Resolution | null => {
  if (width == null || height == null) return null
  // Scope and letterboxed encodes shave height, so width decides as well:
  // 1920x800 is a 1080p file, not a 800p one.
  if (width >= 6400 || height >= 3600) return RESOLUTIONS.uhd8k
  if (width >= 3200 || height >= 1800) return RESOLUTIONS.uhd
  if (width >= 1800 || height >= 1000) return RESOLUTIONS.p1080
  if (width >= 1200 || height >= 700) return RESOLUTIONS.p720
  if (height >= 480) return RESOLUTIONS.p480
  if (height >= 320) return RESOLUTIONS.p320
  return RESOLUTIONS.sd
}
