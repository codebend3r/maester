import {
  AUDIO_BITRATES,
  type AudioBitrate,
  type AudioPlatform,
  TRACK_STREAM_KINDS,
  type Track,
  type TrackStream,
  canPlayAudio,
} from '@raven/core'

/** What a player asks the server for a track (null for the file itself) and what that plays. */
export type TrackStreamPlan = { kbps: AudioBitrate | null; stream: TrackStream }

type TrackStreamOfProps = {
  track: Track
  /** Whose player decodes it: AVPlayer on Apple's devices, ExoPlayer on Android's. */
  platform: AudioPlatform
  /** The bitrate the listener chose for this network, or null for none (always, on a TV). */
  chosenKbps: AudioBitrate | null
}

/**
 * What a track plays from the server: the transcode at the listener's chosen bitrate, else the
 * transcode at 256 kbps for a file this player cannot decode (ALAC on Android, Opus in WebM on
 * Apple's), else the file itself. A track the server has not probed yet names no codec, and the
 * player is left to try it.
 */
export const trackStreamOf = ({
  track,
  platform,
  chosenKbps,
}: TrackStreamOfProps): TrackStreamPlan => {
  const canDecode =
    track.codec === null ||
    canPlayAudio({ platform, codec: track.codec, container: track.container })
  const kbps = chosenKbps ?? (canDecode ? null : AUDIO_BITRATES.standard)
  return {
    kbps,
    stream:
      kbps === null
        ? { kind: TRACK_STREAM_KINDS.file }
        : { kind: TRACK_STREAM_KINDS.transcode, kbps },
  }
}
