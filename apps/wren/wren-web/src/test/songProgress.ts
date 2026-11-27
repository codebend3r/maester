import type { Track } from '@raven/core'
import { act } from '@testing-library/react'
import { serverAddress } from '@/lib/serverAddress'
import { useSongProgress } from '@/stores/songProgress'

/** How far in a song left partway was left, in seconds. */
const PARTWAY_S = 120

type KeepSongsProps = { partway?: readonly Track[]; finished?: readonly Track[] }

/** Puts songs in this browser's progress: each of `finished` played to its end, then each of `partway` left partway. */
export const keepSongs = ({ partway = [], finished = [] }: KeepSongsProps): void => {
  const { note } = useSongProgress.getState()
  const serverId = serverAddress()
  finished.forEach((track) => note({ serverId, track, position: track.duration ?? 0 }))
  partway.forEach((track) => note({ serverId, track, position: PARTWAY_S }))
}

/** Forgets every song's progress in this browser, as a test that kept some puts back; a page still drawn redraws in `act`. */
export const forgetSongs = (): void => {
  act(() => useSongProgress.getState().clear())
}
