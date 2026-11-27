import type { Track } from '@raven/core'
import { RAVEN_SERVER } from '@raven/native/headless'
import { useSongProgress } from '@/stores/songProgress'

/** How far in a song left partway was left, in seconds. */
const PARTWAY_S = 120

type KeepSongsProps = { partway?: readonly Track[]; finished?: readonly Track[] }

/**
 * Puts songs in this device's progress on the home server, before a screen is drawn: each of
 * `finished` played to its end, then each of `partway` left partway.
 */
export const keepSongs = ({ partway = [], finished = [] }: KeepSongsProps): void => {
  const { note } = useSongProgress.getState()
  const serverId = RAVEN_SERVER.id
  finished.forEach((track) => note({ serverId, track, position: track.duration ?? 0 }))
  partway.forEach((track) => note({ serverId, track, position: PARTWAY_S }))
}
