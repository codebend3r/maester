import {
  AUDIO_PLATFORMS,
  type MediaItem,
  type Track,
  canPlayAudio,
  checkDirectPlay,
  videoCodecString,
} from '@raven/core'

import { DOWNLOAD_COPY } from '@/downloads/copy'
import { DOWNLOAD_WAYS } from '@/downloads/downloadEntries'
import { canPlayFor } from '@/platform/canPlay'
import type { AppPlatform } from '@/platform/platform'

/** What a video download fetches, or why none can. */
export type VideoWay =
  | { way: typeof DOWNLOAD_WAYS.file | typeof DOWNLOAD_WAYS.copy }
  | { way: null; reason: string }

type VideoWayOfProps = { platform: AppPlatform; media: MediaItem }

/**
 * How a video downloads to this device: its original file when the player takes it as it is
 * for sure (no maybe, since a download has no remux to step down to), else the server's MP4
 * copy when the player decodes the video inside an MP4 (the copy keeps the video and makes the
 * audio AAC), else not at all. A video not yet probed is given the benefit of the doubt, as
 * direct play gives it.
 */
export const videoWayOf = ({ platform, media }: VideoWayOfProps): VideoWay => {
  const { canPlay, canPlaySurely } = canPlayFor(platform)
  const check = checkDirectPlay({ media, canPlay: canPlaySurely })
  if (check.playable) return { way: DOWNLOAD_WAYS.file }
  const video =
    media.videoCodec === null
      ? null
      : videoCodecString({ codec: media.videoCodec, bitDepth: media.videoBitDepth })
  if (video !== null && canPlay(`video/mp4; codecs="${video}"`)) return { way: DOWNLOAD_WAYS.copy }
  return { way: null, reason: [DOWNLOAD_COPY.cantDownload, ...check.problems].join(' ') }
}

type TrackFile = Pick<Track, 'codec' | 'container'>

type TrackWay = typeof DOWNLOAD_WAYS.file | typeof DOWNLOAD_WAYS.transcode

/** What a track download fetches: its file, or the AAC transcode of one AVPlayer cannot decode. */
export const trackWayOf = ({ codec, container }: TrackFile): TrackWay =>
  codec === null || canPlayAudio({ platform: AUDIO_PLATFORMS.apple, codec, container })
    ? DOWNLOAD_WAYS.file
    : DOWNLOAD_WAYS.transcode
