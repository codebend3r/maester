import type { Track } from '@raven/core'
import { AUDIO_STATES, type DeviceSpotOf, playingTrackOf, useAudioQueue } from '@raven/ui/headless'
import { type HeardSong, type SongSave, resumeAtOf, songLeftOf, songStepOf } from '@raven/wren'
import { useEffect, useEffectEvent, useRef } from 'react'

import { useSongProgress } from '@/stores/songProgress'

type ServerProps = { serverId: string }

/**
 * Keeps each song's progress on this device as the queue plays it: where it was left partway,
 * as it pauses, every few seconds of play and as another song takes over, and when it played to
 * its end. The music host mounts it beside its player, so whatever plays is kept.
 */
export const useKeepSongProgress = ({ serverId }: ServerProps): void => {
  const track = useAudioQueue(playingTrackOf)
  const position = useAudioQueue((store) => store.position)
  const isPlaying = useAudioQueue((store) => store.state === AUDIO_STATES.playing)
  const heard = useRef<HeardSong<Track> | null>(null)

  const keep = useEffectEvent((saves: readonly SongSave<Track>[]) => {
    const { note } = useSongProgress.getState()
    saves.forEach((save) => note({ serverId, ...save }))
  })
  useEffect(() => {
    const step = songStepOf({ heard: heard.current, track, position, isPlaying })
    heard.current = step.heard
    keep(step.saves)
  }, [track, position, isPlaying])
  useEffect(() => () => keep(songLeftOf(heard.current)), [])
}

/** Where this device left a server's song, read as it starts, for the music host to start it at. */
export const deviceSpotFor =
  ({ serverId }: ServerProps): DeviceSpotOf =>
  (track) =>
    resumeAtOf({ songs: useSongProgress.getState().songs, serverId, trackId: track.id })
