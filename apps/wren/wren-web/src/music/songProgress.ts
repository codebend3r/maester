import type { Track } from '@raven/core'
import { watchPageHide } from '@raven/ui'
import { AUDIO_STATES, type DeviceSpotOf, playingTrackOf, useAudioQueue } from '@raven/ui/headless'
import { type HeardSong, type SongSave, resumeAtOf, songLeftOf, songStepOf } from '@raven/wren'
import { useEffect, useEffectEvent, useRef } from 'react'
import { serverAddress } from '@/lib/serverAddress'
import { useSongProgress } from '@/stores/songProgress'

/**
 * Keeps each song's progress in this browser as the queue plays it: where it was left partway,
 * as it pauses, every few seconds of play, as another song takes over and as the page goes (a
 * closed tab, a reload, Wren for Mac quitting), and when it played to its end. The shell mounts it beside the audio host, so whatever plays is kept.
 */
export const useKeepSongProgress = (): void => {
  const track = useAudioQueue(playingTrackOf)
  const position = useAudioQueue((store) => store.position)
  const isPlaying = useAudioQueue((store) => store.state === AUDIO_STATES.playing)
  const heard = useRef<HeardSong<Track> | null>(null)

  const keep = useEffectEvent((saves: readonly SongSave<Track>[]) => {
    const { note } = useSongProgress.getState()
    const serverId = serverAddress()
    saves.forEach((save) => note({ serverId, ...save }))
  })
  useEffect(() => {
    const step = songStepOf({ heard: heard.current, track, position, isPlaying })
    heard.current = step.heard
    keep(step.saves)
  }, [track, position, isPlaying])
  useEffect(() => () => keep(songLeftOf(heard.current)), [])
  useEffect(() => watchPageHide(() => keep(songLeftOf(heard.current))), [])
}

/** Where this browser left a song, read as it starts, for the audio host to start it at. */
export const deviceSpotOf: DeviceSpotOf = (track) =>
  resumeAtOf({
    songs: useSongProgress.getState().songs,
    serverId: serverAddress(),
    trackId: track.id,
  })
