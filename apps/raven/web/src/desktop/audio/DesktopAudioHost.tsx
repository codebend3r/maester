import {
  type ApiClient,
  ARTWORK_MAX_BYTES,
  AUDIO_COMMANDS,
  AUDIO_EVENTS,
  type AudioCommand,
  type AudioEvent,
  REMOTE_COMMANDS,
  type RemoteCommand,
  type Track,
} from '@raven/core'
import { AudioHost } from '@raven/ui'
import {
  AUDIO_STATES,
  nextTrackOf,
  playingTrackOf,
  useAudioQueue,
  useListenCounter,
  usePlayerPrefs,
} from '@raven/ui/headless'
import { useEffect, useEffectEvent, useRef } from 'react'
import { CONNECTION_STATUSES } from '@/desktop/portConnection'
import { type NativeAudio, useAudioConnection } from '@/desktop/audioConnection'

const COULD_NOT_PLAY = 'Raven could not play this track.'

const messageOf = (error: unknown): string =>
  error instanceof Error && error.message !== '' ? error.message : COULD_NOT_PLAY

type ArtworkOfProps = { api: ApiClient; track: Track }

/** A track's cover as bytes for Now Playing, or null when there is none or it cannot be read. */
const artworkOf = async ({ api, track }: ArtworkOfProps) => {
  const url = api.albumCoverUrl({ albumId: track.albumId, coverVersion: track.album.coverVersion })
  if (url === null) return null
  try {
    const response = await fetch(url)
    if (!response.ok) return null
    const bytes = await response.arrayBuffer()
    return bytes.byteLength <= ARTWORK_MAX_BYTES ? bytes : null
  } catch {
    return null
  }
}

/** What mpv is playing and has ready after it, as this host last told main. */
type Loaded = { id: number; next: number | null }

/** Where the playing track is and how long it is, as mpv last said. */
type Clock = { position: number; duration: number | null }

type NativeAudioHostProps = {
  api: ApiClient
  player: NativeAudio
}

/**
 * Raven's music engine, driven from the shared queue store as the web's `<audio>` host
 * is: main hears the playing track and the one after it, plays the two with no gap, and
 * says when it moved on, which this host turns into the queue stepping. The system's
 * transport controls arrive the same way and drive the store.
 */
const NativeAudioHost = ({ api, player }: NativeAudioHostProps) => {
  const track = useAudioQueue(playingTrackOf)
  const upNext = useAudioQueue(nextTrackOf)
  const state = useAudioQueue((store) => store.state)
  const seek = useAudioQueue((store) => store.seek)
  const engine = useAudioQueue((store) => store.engine)
  const play = useAudioQueue((store) => store.play)
  const pause = useAudioQueue((store) => store.pause)
  const toggle = useAudioQueue((store) => store.toggle)
  const skipNext = useAudioQueue((store) => store.next)
  const skipPrevious = useAudioQueue((store) => store.previous)
  const seekTo = useAudioQueue((store) => store.seekTo)
  const clear = useAudioQueue((store) => store.clear)
  const volume = usePlayerPrefs((prefs) => prefs.volume)
  const isMuted = usePlayerPrefs((prefs) => prefs.muted)
  const shouldPlay = state === AUDIO_STATES.playing || state === AUDIO_STATES.loading
  const loaded = useRef<Loaded | null>(null)
  const time = useRef<Clock>({ position: 0, duration: null })
  const trackId = track?.id ?? null
  const nextId = upNext?.id ?? null
  useListenCounter({ api, track })

  // An effect event: it reads the latest player and store, so the effects below need neither.
  const send = useEffectEvent((command: AudioCommand) =>
    player.send(command).catch((error: unknown) => {
      if (command.type === AUDIO_COMMANDS.load) engine.failed(messageOf(error))
    }),
  )

  const onRemote = useEffectEvent((command: RemoteCommand) => {
    switch (command.kind) {
      case REMOTE_COMMANDS.play:
        return play()
      case REMOTE_COMMANDS.pause:
        return pause()
      case REMOTE_COMMANDS.toggle:
        return toggle()
      case REMOTE_COMMANDS.next:
        return skipNext()
      case REMOTE_COMMANDS.previous:
        return skipPrevious()
      case REMOTE_COMMANDS.stop:
        return clear()
      case REMOTE_COMMANDS.seek:
        return seekTo(command.time)
      default: {
        const unreachable: never = command
        return unreachable
      }
    }
  })

  const onEvent = useEffectEvent((event: AudioEvent) => {
    switch (event.type) {
      case AUDIO_EVENTS.time:
        time.current = { ...time.current, position: event.time }
        return engine.time(time.current)
      case AUDIO_EVENTS.duration:
        time.current = { ...time.current, duration: event.duration }
        return engine.time(time.current)
      case AUDIO_EVENTS.paused:
        return engine.state(event.paused ? AUDIO_STATES.paused : AUDIO_STATES.playing)
      case AUDIO_EVENTS.waiting:
        if (event.waiting) engine.state(AUDIO_STATES.loading)
        return
      case AUDIO_EVENTS.advanced:
        // mpv is already on the next track: the queue follows, and only what comes after is new.
        loaded.current =
          loaded.current === null || loaded.current.next === null
            ? null
            : { id: loaded.current.next, next: null }
        return engine.ended()
      case AUDIO_EVENTS.ended: {
        const over = loaded.current
        engine.ended()
        const again = playingTrackOf(useAudioQueue.getState())
        // The same track once more (repeat one): mpv has closed it, and the queue has not
        // moved for the effect below to see, so it is asked for here.
        if (over === null || again === null || again.id !== over.id) return
        time.current = { position: 0, duration: null }
        send({ type: AUDIO_COMMANDS.load, mediaId: over.id, next: over.next, start: 0 })
        return
      }
      case AUDIO_EVENTS.error:
        return engine.failed(event.message)
      case AUDIO_EVENTS.remote:
        return onRemote(event.command)
      default: {
        const unreachable: never = event
        return unreachable
      }
    }
  })

  useEffect(() => player.subscribe((event) => onEvent(event)), [player])

  // The playing track and the one after it, as the queue stands.
  useEffect(() => {
    if (trackId === null) {
      if (loaded.current === null) return
      loaded.current = null
      send({ type: AUDIO_COMMANDS.stop })
      return
    }
    const current = loaded.current
    if (current === null || current.id !== trackId) {
      loaded.current = { id: trackId, next: nextId }
      time.current = { position: 0, duration: null }
      send({ type: AUDIO_COMMANDS.load, mediaId: trackId, next: nextId, start: 0 })
      return
    }
    if (current.next === nextId) return
    loaded.current = { id: trackId, next: nextId }
    send({ type: AUDIO_COMMANDS.queueNext, next: nextId })
  }, [trackId, nextId])

  useEffect(() => {
    if (trackId === null) return
    send({ type: shouldPlay ? AUDIO_COMMANDS.play : AUDIO_COMMANDS.pause })
  }, [trackId, shouldPlay])

  useEffect(() => {
    if (seek === null) return
    send({ type: AUDIO_COMMANDS.seek, time: seek.seconds })
    engine.sought()
  }, [seek, engine])

  useEffect(() => {
    send({ type: AUDIO_COMMANDS.volume, volume, muted: isMuted })
  }, [volume, isMuted])

  // What the system shows: the words at once, the cover once its bytes have come.
  const showTrack = useEffectEvent((isCurrent: () => boolean) => {
    if (track === null) return
    const words = {
      title: track.title,
      artist: track.artists.map(({ name }) => name).join(', '),
      album: track.album.title,
    }
    send({ type: AUDIO_COMMANDS.nowPlaying, info: { ...words, artwork: null } })
    artworkOf({ api, track })
      .then((artwork) => {
        if (!isCurrent() || artwork === null) return
        return send({ type: AUDIO_COMMANDS.nowPlaying, info: { ...words, artwork } })
      })
      .catch(() => undefined)
  })
  useEffect(() => {
    if (trackId === null) return
    let isCurrent = true
    showTrack(() => isCurrent)
    return () => {
      isCurrent = false
    }
  }, [trackId])

  return null
}

type DesktopAudioHostProps = {
  api: ApiClient
  /** Asks the media origins to be probed again when the picked one cannot be reached, for the html host. */
  reprobe: () => void
}

/**
 * Music inside Raven: through main's music engine once it is handed over, and through
 * the web's own `<audio>` host when there is none, or it is lost. Nothing renders while
 * main's answer is on its way, so a track never changes engine mid-play.
 */
export const DesktopAudioHost = ({ api, reprobe }: DesktopAudioHostProps) => {
  const connection = useAudioConnection()
  switch (connection.status) {
    case CONNECTION_STATUSES.waiting:
      return null
    case CONNECTION_STATUSES.native:
      return <NativeAudioHost api={api} player={connection.player} />
    case CONNECTION_STATUSES.unavailable:
    case CONNECTION_STATUSES.lost:
      return <AudioHost api={api} reprobe={reprobe} />
    default: {
      const unreachable: never = connection
      return unreachable
    }
  }
}
