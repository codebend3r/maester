import {
  type CanPlay,
  checkDirectPlay,
  DEVICE_DOWNLOAD_VARIANTS,
  type DeviceDownloadVariant,
  dolbyVisionCodecString,
  type MediaItem,
  videoCodecString,
} from '@raven/core'

/** The bytes a browser keeps of a video: its own file, or one of the server's two copies. */
export const DOWNLOAD_WAYS = { file: 'file', copy: 'copy', sdr: 'sdr' } as const

export type DownloadWay = (typeof DOWNLOAD_WAYS)[keyof typeof DOWNLOAD_WAYS]

/** The copy the server makes for a way; the original file needs none. */
export const VARIANT_OF = {
  [DOWNLOAD_WAYS.file]: null,
  [DOWNLOAD_WAYS.copy]: DEVICE_DOWNLOAD_VARIANTS.copy,
  [DOWNLOAD_WAYS.sdr]: DEVICE_DOWNLOAD_VARIANTS.sdr,
} as const satisfies Record<DownloadWay, DeviceDownloadVariant | null>

/** Both copies are MP4s, whatever the original's container. */
export const COPY_EXTENSION = 'mp4'

/** What a browser is asked whether it plays: an MP4 of one video codec. */
const mp4Of = (codec: string): string => `video/mp4; codecs="${codec}"`

/*
 * A Dolby Vision only title is profile 5. The index keeps no level, so the browser is asked about
 * a representative one, 4K at 24 frames, as `videoCodecString` asks about a representative
 * profile: a device that decodes it decodes the lower ones.
 */
const DOLBY_VISION_MIME = mp4Of(dolbyVisionCodecString({ profile: 5, level: 6 }))

/** Whether this browser keeps a Dolby Vision only title: only where it says it plays `dvh1` (Safari on hardware that does). */
export const keepsDolbyVision = (canPlay: CanPlay): boolean => canPlay(DOLBY_VISION_MIME)

type DownloadWayOfProps = { media: MediaItem; canPlay: CanPlay }

type IsKeepableProps = DownloadWayOfProps

/**
 * Whether this browser keeps a video at all. A Dolby Vision only title has no copy for a browser
 * that does not play Dolby Vision: its original shows purple and green there, and the server
 * makes no SDR copy of it, which took a day a film on the NAS.
 */
export const isKeepable = ({ media, canPlay }: IsKeepableProps): boolean =>
  !media.isDolbyVisionOnly || keepsDolbyVision(canPlay)

/**
 * Which bytes this browser keeps of a video it keeps (`isKeepable`). A Dolby Vision only title is
 * never its original: it is the server's `dvh1` copy. Any other video is its original file when
 * the browser plays it as it is, the MP4 copy when it plays the picture but not the container (an
 * MKV of H.264), and the SDR copy, which every browser plays, when it plays neither.
 */
export const downloadWayOf = ({ media, canPlay }: DownloadWayOfProps): DownloadWay => {
  if (media.isDolbyVisionOnly) return DOWNLOAD_WAYS.copy
  if (checkDirectPlay({ media, canPlay }).playable) return DOWNLOAD_WAYS.file
  const video =
    media.videoCodec === null
      ? null
      : videoCodecString({ codec: media.videoCodec, bitDepth: media.videoBitDepth })
  if (video !== null && canPlay(mp4Of(video))) return DOWNLOAD_WAYS.copy
  return DOWNLOAD_WAYS.sdr
}
