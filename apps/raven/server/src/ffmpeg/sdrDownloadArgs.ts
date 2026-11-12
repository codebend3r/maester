import type { AudioTrack } from '@raven/core'
import { QUIET, TONEMAP_FILTER, VIDEO_STREAM } from '@/ffmpeg/args'
import { finishedMp4Args, textSubtitleMaps } from '@/ffmpeg/deviceDownloadArgs'

/**
 * How an SDR copy's picture reaches 8-bit BT.709.
 *
 * - `tonemap`: the zscale tone map every other HDR conversion here uses, for HDR10 and HLG.
 * - `plain`: a picture that is SDR already is only scaled and brought to 8 bits.
 *
 * Neither reads Dolby Vision's own metadata, so a profile 5 picture has no SDR copy: the
 * one filter that does, libplacebo, ran at under two frames a second on the NAS.
 */
export const SDR_PICTURES = { tonemap: 'tonemap', plain: 'plain' } as const

export type SdrPicture = (typeof SDR_PICTURES)[keyof typeof SDR_PICTURES]

type SdrPictureOfProps = {
  isHdr: boolean
  /** Whether zscale's tone map is there: `FfmpegService.canTonemap`. */
  canTonemap: boolean
}

/** The way this server turns a picture into SDR. HDR without the tone map is encoded as it is, washed out, as a live transcode is. */
export const sdrPictureOf = ({ isHdr, canTonemap }: SdrPictureOfProps): SdrPicture =>
  isHdr && canTonemap ? SDR_PICTURES.tonemap : SDR_PICTURES.plain

/*
 * The frame fitted inside 1920 by 1080 without ever growing, its shape kept and both sides
 * even, as H.264 in 4:2:0 needs.
 */
const FIT =
  "w='min(1920,iw)':h='min(1080,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2"

const EIGHT_BIT = 'format=yuv420p'

const FILTERS = {
  // Scaled first, so the tone map, the slow part on a CPU, works on the smaller frame.
  [SDR_PICTURES.tonemap]: `scale=${FIT},${TONEMAP_FILTER}`,
  [SDR_PICTURES.plain]: `scale=${FIT},${EIGHT_BIT}`,
} as const satisfies Record<SdrPicture, string>

/** Every browser decodes AAC in stereo; surround in an MP4 is left to the players that take the original. */
const AUDIO = ['-c:a', 'aac', '-ac', '2', '-b:a', '192k']

type AudioOrderProps = {
  audio: readonly AudioTrack[]
  /** The `0:a:N` track the file plays by default, or null for a file without sound. */
  defaultAudio: number | null
}

/** The `0:a:N` tracks in the order the copy carries them: the file's default first, then the rest as they come. */
const audioOrder = ({ audio, defaultAudio }: AudioOrderProps): number[] => {
  const indexes = audio.map((track) => track.index)
  return [
    ...indexes.filter((index) => index === defaultAudio),
    ...indexes.filter((index) => index !== defaultAudio),
  ]
}

type SdrDownloadArgsProps = AudioOrderProps & {
  input: string
  output: string
  picture: SdrPicture
  /** The `0:s:N` text subtitle tracks to carry as `mov_text`; picture ones are never listed. */
  textSubtitles: readonly number[]
}

/**
 * A video as an MP4 any browser plays offline: its picture encoded again as 8-bit H.264
 * (High profile, BT.709, inside 1920 by 1080), every audio track as AAC stereo, the text
 * subtitles as `mov_text`, the languages, titles and chapters kept, and the index first.
 *
 * The file's default audio track goes first and alone carries the default flag: Chrome and
 * Firefox offer no choice of track and play the first, while Safari lists them all, so
 * every track is kept and the right one plays where none can be picked.
 *
 * The encode is libx264 on the CPU whatever the live transcode uses. A hardware encoder
 * would need its frames uploaded after a filter that runs in memory, and a file made once
 * gains more from x264's quality at a CRF than from the speed.
 */
export const sdrDownloadArgs = ({
  input,
  output,
  picture,
  audio,
  defaultAudio,
  textSubtitles,
}: SdrDownloadArgsProps): string[] => {
  const order = audioOrder({ audio, defaultAudio })
  return [
    ...QUIET,
    '-y',
    '-i',
    input,
    '-map',
    VIDEO_STREAM,
    ...order.flatMap((index) => ['-map', `0:a:${index}`]),
    ...textSubtitleMaps(textSubtitles),
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '20',
    '-profile:v',
    'high',
    '-pix_fmt',
    'yuv420p',
    '-vf',
    FILTERS[picture],
    ...(order.length > 0 ? AUDIO : []),
    ...order.flatMap((_, at) => [`-disposition:a:${at}`, at === 0 ? 'default' : '0']),
    ...finishedMp4Args({ output, textSubtitles }),
  ]
}
