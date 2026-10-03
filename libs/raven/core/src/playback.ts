import type { MediaItem } from './types.js'

/**
 * Asks the client whether it can decode a MIME type such as
 * `video/x-matroska; codecs="hvc1.2.4.L153.B0"`. The web app answers with
 * `HTMLVideoElement.canPlayType`; a native app answers from its own player.
 * Asking the real decoder beats any hand-kept support table: browsers keep
 * adding formats (Chrome plays Matroska now) and hardware decoders differ
 * from machine to machine.
 */
export type CanPlay = (mimeType: string) => boolean

export type DirectPlayCheck = {
  playable: boolean
  /** What stands in the way, in words a viewer can act on. Empty when playable. */
  problems: string[]
}

const CODEC_LABELS: Record<string, string> = {
  h264: 'H.264',
  hevc: 'HEVC',
  vp8: 'VP8',
  vp9: 'VP9',
  av1: 'AV1',
  mpeg4: 'MPEG-4',
  mpeg2video: 'MPEG-2',
  vc1: 'VC-1',
  aac: 'AAC',
  ac3: 'Dolby Digital',
  eac3: 'Dolby Digital Plus',
  truehd: 'Dolby TrueHD',
  dts: 'DTS',
  opus: 'Opus',
  flac: 'FLAC',
  mp3: 'MP3',
  vorbis: 'Vorbis',
}

export const codecLabel = (codec: string | null): string =>
  codec == null ? 'Unknown' : (CODEC_LABELS[codec] ?? codec.toUpperCase())

/**
 * The MIME type a container is served and checked as. MOV and M4V are the
 * same ISO media format as MP4, and browsers that refuse video/quicktime
 * play the bytes fine as video/mp4.
 */
export const containerMimeType = (container: string): string | null => {
  const types: Record<string, string> = {
    mp4: 'video/mp4',
    mov: 'video/mp4',
    '3gp': 'video/3gpp',
    webm: 'video/webm',
    mkv: 'video/x-matroska',
    ogv: 'video/ogg',
    ts: 'video/mp2t',
    m2ts: 'video/mp2t',
    avi: 'video/x-msvideo',
    wmv: 'video/x-ms-wmv',
    flv: 'video/x-flv',
    mpg: 'video/mpeg',
  }
  return types[container] ?? null
}

/**
 * An RFC 6381 codec string for the video track. The profile and level are
 * representative rather than exact (the index keeps codec and bit depth, not
 * the full profile), picked high enough that a "yes" means the file will
 * really decode: High@4.0 for 8-bit H.264, Main 10@5.1 for 10-bit HEVC.
 */
export const videoCodecString = ({
  codec,
  bitDepth,
}: {
  codec: string
  bitDepth: number | null
}): string | null => {
  const deep = (bitDepth ?? 8) > 8
  const strings: Record<string, readonly [string, string]> = {
    h264: ['avc1.640028', 'avc1.6E0028'],
    hevc: ['hvc1.1.6.L150.B0', 'hvc1.2.4.L153.B0'],
    vp8: ['vp8', 'vp8'],
    vp9: ['vp09.00.51.08', 'vp09.02.51.10'],
    av1: ['av01.0.08M.08', 'av01.0.12M.10'],
  }
  const pair = strings[codec]
  return pair ? pair[deep ? 1 : 0] : null
}

export const audioCodecString = (codec: string): string | null => {
  const strings: Record<string, string> = {
    aac: 'mp4a.40.2',
    mp3: 'mp4a.6B',
    opus: 'opus',
    vorbis: 'vorbis',
    flac: 'flac',
    alac: 'alac',
    ac3: 'ac-3',
    eac3: 'ec-3',
    dts: 'dtsc',
    truehd: 'mlpa',
  }
  return strings[codec] ?? null
}

/**
 * Can this client play the file exactly as it sits on disk? Container, video
 * and audio are asked about separately so a "no" can say which part is the
 * problem. A file that has not been probed yet is judged on its container
 * alone and given the benefit of the doubt.
 */
export const checkDirectPlay = ({
  media,
  canPlay,
}: {
  media: MediaItem
  canPlay: CanPlay
}): DirectPlayCheck => {
  const mime = containerMimeType(media.container)
  if (mime == null || !canPlay(mime)) {
    return {
      playable: false,
      problems: [`The ${media.container.toUpperCase()} container isn't supported here.`],
    }
  }

  const videoProblems = ((): string[] => {
    if (media.videoCodec == null) return []
    const codecs = videoCodecString({ codec: media.videoCodec, bitDepth: media.videoBitDepth })
    const depth = (media.videoBitDepth ?? 8) > 8 ? `${media.videoBitDepth}-bit ` : ''
    const label = `${depth}${codecLabel(media.videoCodec)} video`
    return codecs != null && canPlay(`${mime}; codecs="${codecs}"`)
      ? []
      : [`${label} isn't supported here.`]
  })()

  const audioProblems = ((): string[] => {
    if (media.audioCodec == null) return []
    const codecs = audioCodecString(media.audioCodec)
    return codecs != null && canPlay(`${mime}; codecs="${codecs}"`)
      ? []
      : [`${codecLabel(media.audioCodec)} audio isn't supported here.`]
  })()

  const problems = [...videoProblems, ...audioProblems]
  return { playable: problems.length === 0, problems }
}
