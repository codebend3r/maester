import {
  AT_HOME,
  type MediaItem,
  type MediaTracks,
  PLAYBACK_MODES,
  type PlayNetwork,
  type PlaybackPlan,
  type PlaybackPolicy,
} from '@raven/core'
import type { MediaSources } from '@raven/native/headless'

import { DEVICE_PLATFORM } from '@/platform/devicePlatform'
import { type PlaybackPrefs, planFor } from '@/platform/playbackPlan'

/** A video downloaded to this device, as the player opens it. */
export type LocalCopy = {
  /** The file's `file://` address. */
  uri: string
  /** The original file's tracks for the pickers; null for the server's copy, whose tracks are its own. */
  tracks: MediaTracks | null
}

/** A download plays as it is, the one way there is: no remux or transcode of a file on the device. */
const LOCAL_PLAN: PlaybackPlan = { modes: [PLAYBACK_MODES.direct], problems: [] }

/**
 * How a video is played: the ladder of ways, where each way's source comes from, the tracks the
 * pickers list, and whether the Quality picker has anything to offer. The server's video and a
 * download on the device each make one, and the player tells them apart no further.
 */
export type PlayWay = {
  plan: PlaybackPlan
  sources: MediaSources
  tracks: MediaTracks | null
  hasQuality: boolean
}

type ServerWayOfProps = {
  media: MediaItem
  tracks: MediaTracks | null
  policy: PlaybackPolicy
  prefs: PlaybackPrefs
  network: PlayNetwork
  sources: MediaSources
}

/** The server's video: planned by `planFor` under the policy and the prefs, with the Quality picker. */
export const serverWayOf = ({
  media,
  tracks,
  policy,
  prefs,
  network,
  sources,
}: ServerWayOfProps): PlayWay => ({
  plan: planFor({ platform: DEVICE_PLATFORM, media, policy, prefs, network }),
  sources,
  tracks,
  hasQuality: true,
})

type LocalWayOfProps = { sources: MediaSources; copy: LocalCopy }

/**
 * A download: the file as it is, the one way there is, so nothing for the Quality picker to
 * offer. Its source is the download's file, with no headers and nothing asked of the server, at
 * home wherever the device is; subtitles are still the server's, and fail quietly with it out of
 * reach.
 */
export const localWayOf = ({ sources, copy }: LocalWayOfProps): PlayWay => ({
  plan: LOCAL_PLAN,
  sources: {
    ...sources,
    source: async () => ({ ok: true, source: { uri: copy.uri, headers: {} } }),
    networkFor: async () => AT_HOME,
  },
  tracks: copy.tracks,
  hasQuality: false,
})
