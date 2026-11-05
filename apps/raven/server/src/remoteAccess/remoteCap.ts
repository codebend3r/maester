import {
  PLAYBACK_MODES,
  type PlaybackSettings,
  type RemoteAccessSettings,
  STREAM_QUALITIES,
  type StreamMode,
  type StreamQuality,
  remoteQualityFor,
} from '@raven/core'
import { transcodeBitrate } from '@/ffmpeg/args'
import { streamSizeOf } from '@/playback/conversion'
import { type ClientRequest, isLanRequest } from '@/remoteAccess/clientNetwork'

type StreamSize = (typeof STREAM_QUALITIES)[StreamQuality]

type SizedStream = { key: StreamQuality; size: StreamSize }

type RemoteLimits = Pick<RemoteAccessSettings, 'remoteLimit' | 'uploadMbps'>

type SizeForNetworkProps = {
  /** The size the viewer asked for, or null for the server's own settings. */
  sized: SizedStream | null
  mode: StreamMode
  isLan: boolean
  remote: RemoteLimits
  /** The bits a second a transcode at the server's own settings aims for. */
  defaultBitrate: number
}

/**
 * The size a transcode is made at once Remote Access's limit is applied: a
 * viewer away from home asking for more than the limit (or the upload's
 * share) gets the limit, and so does one left to the server's settings when
 * those aim higher. A viewer at home, a remux and a smaller size are as asked.
 */
export const sizeForNetwork = ({
  sized,
  mode,
  isLan,
  remote,
  defaultBitrate,
}: SizeForNetworkProps): SizedStream | null => {
  if (isLan || mode !== PLAYBACK_MODES.transcode) return sized
  const cap = remoteQualityFor(remote)
  if (cap === null) return sized
  const capSize = STREAM_QUALITIES[cap]
  const askedBitrate = sized?.size.bitrate ?? defaultBitrate
  return askedBitrate > capSize.bitrate ? { key: cap, size: capSize } : sized
}

type StreamSizeForProps = {
  quality: string | undefined
  mode: StreamMode
  request: ClientRequest
  remote: RemoteLimits
  playback: Pick<PlaybackSettings, 'quality'>
}

/** The size a converted stream is made at: the viewer's ask (a 400 if it is not one), under Remote Access's limit away from home. */
export const streamSizeFor = ({
  quality,
  mode,
  request,
  remote,
  playback,
}: StreamSizeForProps): SizedStream | null =>
  sizeForNetwork({
    sized: streamSizeOf({ quality, mode }),
    mode,
    isLan: isLanRequest({ request }),
    remote,
    defaultBitrate: transcodeBitrate({ quality: playback.quality, bitrate: null }),
  })
