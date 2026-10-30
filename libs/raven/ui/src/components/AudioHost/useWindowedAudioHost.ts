import { type ApiClient, REMOTE_COMMANDS, type RemoteCommand, type Track } from '@raven/core'
import { useEffect, useEffectEvent, useRef } from 'react'
import { useListenCounter } from '@/components/AudioHost/useListenCounter'
import { startOf, useAudiobookSpot } from '@/components/AudioHost/useAudiobookSpot'
import type { WatchHide } from '@/components/Player/useProgressReport'
import { AUDIO_STATES, nextTrackOf, playingTrackOf, useAudioQueue } from '@/stores/audioQueue'
import { usePlayerPrefs } from '@/stores/playerPrefs'

/** What a host says when a player refused a track without saying why. */
export const COULD_NOT_PLAY = 'Raven could not play this track.'

/** Why a player refused a track: its own words, or `COULD_NOT_PLAY` when it gave none. */
export const failureOf = (error: unknown): string =>
  error instanceof Error && error.message !== '' ? error.message : COULD_NOT_PLAY

export type WindowedLoadProps = {
  playing: Track
  next: Track | null
  /** Seconds into `playing` to start at: an audiobook's saved spot, else 0. */
  start: number
}

type SetPlayingProps = { shouldPlay: boolean }

type SetVolumeProps = { volume: number; isMuted: boolean }

/**
 * A player that holds the playing track with the next one ready behind it, so the seam plays
 * with no gap: mpv on the desktop, `@raven/audio` on a phone. `load` rejects with why it could
 * not play; the rest fail quietly, as the player's own events say what happened.
 */
export type WindowedPlayer = {
  /** Replaces the window and plays `playing` from `start`, `next` ready behind it from its top. */
  load: (props: WindowedLoadProps) => Promise<void>
  /** Replaces what follows the playing track. */
  queueNext: (next: Track | null) => Promise<void>
  stop: () => Promise<void>
  setPlaying: (props: SetPlayingProps) => Promise<void>
  seek: (seconds: number) => Promise<void>
  setVolume: (props: SetVolumeProps) => Promise<void>
}

/** A lock screen's or a media key's command, carried out on the shared queue store. */
export const runRemoteCommand = (command: RemoteCommand): void => {
  const store = useAudioQueue.getState()
  switch (command.kind) {
    case REMOTE_COMMANDS.play:
      return store.play()
    case REMOTE_COMMANDS.pause:
      return store.pause()
    case REMOTE_COMMANDS.toggle:
      return store.toggle()
    case REMOTE_COMMANDS.next:
      return store.next()
    case REMOTE_COMMANDS.previous:
      return store.previous()
    case REMOTE_COMMANDS.stop:
      return store.clear()
    case REMOTE_COMMANDS.seek:
      return store.seekTo(command.time)
    default: {
      const unreachable: never = command
      return unreachable
    }
  }
}

/** What the player holds, as the host last told it: the playing track's id and the next's. */
type Loaded = { id: number; next: number | null }

/**
 * The queue's playing track and the next, by id, as `follow` takes them; null for none. `start`
 * is where the playing track starts, null while its spot is still being read.
 */
type FollowProps = { id: number | null; next: number | null; start: number | null }

type UseWindowedAudioHostProps = {
  api: ApiClient
  player: WindowedPlayer
  /** Calls its save as the host is about to go away, so an audiobook's spot is kept: the desktop's page hide. */
  watchHide: WatchHide
}

/** What the player's own events tell the host: it moved on to the next track, or ran out. */
export type WindowedAudioHost = { advanced: () => void; ended: () => void }

/**
 * Drives a windowed player from the shared queue store: the playing track and the one after it,
 * play and pause, seeks and the volume. The player says when it moved on by itself (`advanced`)
 * or ran out (`ended`), and the queue steps with it. An audiobook loads at its saved spot, read
 * before the load, and saves its spot as it plays; music starts at its top and saves none. A
 * track the player moved on to by itself plays from its top, as the seam allows nothing else.
 */
export const useWindowedAudioHost = ({
  api,
  player,
  watchHide,
}: UseWindowedAudioHostProps): WindowedAudioHost => {
  const track = useAudioQueue(playingTrackOf)
  const state = useAudioQueue((store) => store.state)
  const seek = useAudioQueue((store) => store.seek)
  const engine = useAudioQueue((store) => store.engine)
  const volume = usePlayerPrefs((prefs) => prefs.volume)
  const isMuted = usePlayerPrefs((prefs) => prefs.muted)
  const shouldPlay = state === AUDIO_STATES.playing || state === AUDIO_STATES.loading
  const loaded = useRef<Loaded | null>(null)
  const trackId = track?.id ?? null
  const nextId = useAudioQueue((store) => nextTrackOf(store)?.id ?? null)
  useListenCounter({ api, track })
  const start = startOf(useAudiobookSpot({ api, track, watchHide }))

  const load = useEffectEvent(({ playing, next, start: from }: WindowedLoadProps) => {
    loaded.current = { id: playing.id, next: next?.id ?? null }
    // The clock starts where the player will, so nothing reads the spot as 0 before it says so.
    if (from > 0) engine.time({ position: from, duration: useAudioQueue.getState().duration })
    player
      .load({ playing, next, start: from })
      .catch((error: unknown) => engine.failed(failureOf(error)))
  })

  // The playing track and the one after it, as the queue stands.
  const follow = useEffectEvent((ids: FollowProps) => {
    const { tracks } = useAudioQueue.getState()
    const playing = ids.id === null ? null : (tracks[ids.id] ?? null)
    const following = ids.next === null ? null : (tracks[ids.next] ?? null)
    if (playing === null) {
      if (loaded.current === null) return
      loaded.current = null
      player.stop().catch(() => undefined)
      return
    }
    const current = loaded.current
    if (current === null || current.id !== playing.id) {
      if (ids.start !== null) load({ playing, next: following, start: ids.start })
      return
    }
    if (current.next === ids.next) return
    loaded.current = { id: playing.id, next: ids.next }
    player.queueNext(following).catch(() => undefined)
  })
  useEffect(() => follow({ id: trackId, next: nextId, start }), [trackId, nextId, start])

  const setPlaying = useEffectEvent((isOn: boolean) => {
    player.setPlaying({ shouldPlay: isOn }).catch(() => undefined)
  })
  useEffect(() => {
    if (trackId === null) return
    setPlaying(shouldPlay)
  }, [trackId, shouldPlay])

  const seekTo = useEffectEvent((seconds: number) => {
    player.seek(seconds).catch(() => undefined)
    engine.sought()
  })
  useEffect(() => {
    if (seek === null) return
    seekTo(seek.seconds)
  }, [seek])

  const setVolume = useEffectEvent((level: SetVolumeProps) => {
    player.setVolume(level).catch(() => undefined)
  })
  useEffect(() => setVolume({ volume, isMuted }), [volume, isMuted])

  return {
    advanced: () => {
      // The player is already on the next track: the queue follows, and only what comes after is new.
      const next = loaded.current?.next ?? null
      loaded.current = next === null ? null : { id: next, next: null }
      engine.ended()
    },
    ended: () => {
      const over = loaded.current
      engine.ended()
      const store = useAudioQueue.getState()
      const again = playingTrackOf(store)
      // The same track once more (repeat one): the player has closed it, and the queue has not
      // moved for `follow` to see, so it is loaded again here.
      if (over === null || again === null || again.id !== over.id) return
      load({ playing: again, next: nextTrackOf(store), start: 0 })
    },
  }
}
