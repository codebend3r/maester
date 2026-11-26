import {
  AUDIO_BITRATES,
  type AudioBitrate,
  type AudioPlatform,
  TRACK_STREAM_KINDS,
  type Track,
  type TrackStream,
  canPlayAudio,
} from '@raven/core'

/** What a TV asks the server for a track: its file, or the AAC transcode, and what it plays. */
type TrackRequestPlan = { kbps: AudioBitrate | null; stream: TrackStream }

type TrackRequestOfProps = { track: Track; platform: AudioPlatform }

/**
 * What a track plays from on this TV: the file itself, or the server's AAC transcode at 256 kbps
 * for a file this TV's player cannot decode (ALAC on Android TV, Opus in WebM on Apple TV). A
 * track the server has not probed names no codec, and the player is left to try it. A TV has no
 * downloads and no mobile network, so nothing else is asked.
 */
export const trackRequestOf = ({ track, platform }: TrackRequestOfProps): TrackRequestPlan => {
  const canDecode =
    track.codec === null ||
    canPlayAudio({ platform, codec: track.codec, container: track.container })
  return canDecode
    ? { kbps: null, stream: { kind: TRACK_STREAM_KINDS.file } }
    : {
        kbps: AUDIO_BITRATES.standard,
        stream: { kind: TRACK_STREAM_KINDS.transcode, kbps: AUDIO_BITRATES.standard },
      }
}
