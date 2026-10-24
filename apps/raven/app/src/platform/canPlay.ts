import {
  CONTAINERS,
  type CanPlay,
  HLS_COPY_AUDIO,
  VIDEO_CODECS,
  audioCodecString,
  containerMimeType,
  isString,
  type planPlayback,
  videoCodecString,
} from '@raven/core'

import { APP_PLATFORMS, type AppPlatform } from '@/platform/platform'

/**
 * What a platform's player takes as it is, in the names a `MediaItem` carries (ffprobe's).
 * Each video codec lists the bit depths it decodes, as `videoCodecString` tells them apart:
 * it writes one string for 8 bits and one for anything deeper, so 10 stands for 12 too.
 */
type PlayTable = {
  containers: readonly string[]
  videoCodecs: Readonly<Record<string, readonly number[]>>
  audioCodecs: readonly string[]
}

/**
 * AVPlayer on iPhone, iPad and Apple TV: MP4 and MOV holding 8-bit H.264 or HEVC at any
 * depth, with the audio the HLS route copies, which is the audio AVPlayer decodes. It has no
 * High 10 decoder, and a remux copies the same video, so `canStream` refuses 10-bit H.264 as
 * well and the plan goes straight to the transcode. HEVC in MP4 is a maybe, since AVPlayer
 * refuses it under the `hev1` tag and the index does not keep the tag: it counts as a yes, as
 * a browser's "maybe" does, and a refusal steps down to the remux, which re-tags it `hvc1`.
 */
const APPLE = {
  containers: [CONTAINERS.mp4, CONTAINERS.mov],
  videoCodecs: { [VIDEO_CODECS.h264]: [8], [VIDEO_CODECS.hevc]: [8, 10] },
  audioCodecs: HLS_COPY_AUDIO,
} as const satisfies PlayTable

/** Android TV answers as Apple does until ExoPlayer has a table of its own. */
const PLAY_TABLES: Record<AppPlatform, PlayTable> = {
  [APP_PLATFORMS.ios]: APPLE,
  [APP_PLATFORMS.tvos]: APPLE,
  [APP_PLATFORMS.androidTv]: APPLE,
}

const CODECS_PARAM = /codecs="([^"]*)"/

/** A MIME type as core writes it: `video/mp4`, or `video/mp4; codecs="avc1.640028,mp4a.40.2"`. */
const mimePartsOf = (mimeType: string): { type: string; codecs: string[] } => {
  const [type = '', ...params] = mimeType.split(';')
  const listed = CODECS_PARAM.exec(params.join(';'))?.[1] ?? ''
  return {
    type: type.trim(),
    codecs: listed
      .split(',')
      .map((codec) => codec.trim())
      .filter((codec) => codec !== ''),
  }
}

/** Yes when the container and every codec named are in the table, in core's strings. */
const canPlayFrom = (table: PlayTable): CanPlay => {
  const types = new Set(
    table.containers.map((container) => containerMimeType(container)).filter(isString),
  )
  const codecs = new Set(
    [
      ...Object.entries(table.videoCodecs).flatMap(([codec, bitDepths]) =>
        bitDepths.map((bitDepth) => videoCodecString({ codec, bitDepth })),
      ),
      ...table.audioCodecs.map((codec) => audioCodecString(codec)),
    ].filter(isString),
  )
  return (mimeType) => {
    const asked = mimePartsOf(mimeType)
    return types.has(asked.type) && asked.codecs.every((codec) => codecs.has(codec))
  }
}

type PlatformSupport = Pick<Parameters<typeof planPlayback>[0], 'canPlay' | 'canStream'>

/**
 * What `planPlayback` asks this platform. React Native has no `canPlayType`, so the answers
 * come from a table. The app converts through the server's HLS route, never Media Source
 * Extensions: fragmented MP4 (`streamMimeType`'s `video/mp4`) with the video copied or made
 * H.264, and the audio copied or made E-AC-3, both of which the table plays. A stream plays,
 * then, where its video plays in MP4, which is what `canPlay` answers for that string: the
 * stereo AAC `streamMimeType` names is in `HLS_COPY_AUDIO`, so the audio never refuses one.
 */
export const canPlayFor = (platform: AppPlatform): PlatformSupport => {
  const canPlay = canPlayFrom(PLAY_TABLES[platform])
  return { canPlay, canStream: canPlay }
}
