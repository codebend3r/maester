import {
  type ApiClient,
  ARTWORK_MAX_BYTES,
  AUDIO_COMMANDS,
  AUDIO_EVENTS,
  type AudioEvent,
  type Track,
  artistNames,
} from '@raven/core'
import { AudioHost, watchPageHide } from '@raven/ui'
import {
  AUDIO_STATES,
  type WindowedPlayer,
  playingTrackOf,
  runRemoteCommand,
  useAudioQueue,
  useTrackRate,
  useWindowedAudioHost,
} from '@raven/ui/headless'
import { useEffect, useEffectEvent, useMemo } from 'react'
import { CONNECTION_STATUSES } from '@/desktop/portConnection'
import { type NativeAudio, useAudioConnection } from '@/desktop/audioConnection'

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

/** Main's music engine as the shared windowed host drives it: each call one command on the port. */
const windowedPlayerOf = (player: NativeAudio): WindowedPlayer => ({
  load: ({ playing, next, start }) =>
    player.send({
      type: AUDIO_COMMANDS.load,
      mediaId: playing.id,
      next: next?.id ?? null,
      start,
    }),
  queueNext: (next) => player.send({ type: AUDIO_COMMANDS.queueNext, next: next?.id ?? null }),
  stop: () => player.send({ type: AUDIO_COMMANDS.stop }),
  setPlaying: ({ shouldPlay }) =>
    player.send({ type: shouldPlay ? AUDIO_COMMANDS.play : AUDIO_COMMANDS.pause }),
  seek: (time) => player.send({ type: AUDIO_COMMANDS.seek, time }),
  setVolume: ({ volume, isMuted }) =>
    player.send({ type: AUDIO_COMMANDS.volume, volume, muted: isMuted }),
})

type NativeAudioHostProps = {
  api: ApiClient
  player: NativeAudio
}

/**
 * Raven's music engine, driven from the shared queue store through the windowed host: main
 * holds the playing track and the one after it, plays the two with no gap, and says when it
 * moved on. The system's transport controls arrive the same way and drive the store. An
 * audiobook plays at the speed the prefs hold, and music at 1; mpv keeps the pitch either way.
 */
const NativeAudioHost = ({ api, player }: NativeAudioHostProps) => {
  const track = useAudioQueue(playingTrackOf)
  const engine = useAudioQueue((store) => store.engine)
  const windowed = useMemo(() => windowedPlayerOf(player), [player])
  const host = useWindowedAudioHost({ api, player: windowed, watchHide: watchPageHide })
  const trackId = track?.id ?? null
  const rate = useTrackRate({ api, track })

  const setRate = useEffectEvent((speed: number) => {
    player.send({ type: AUDIO_COMMANDS.speed, rate: speed }).catch(() => undefined)
  })
  useEffect(() => setRate(rate), [rate])

  const onEvent = useEffectEvent((event: AudioEvent) => {
    switch (event.type) {
      // mpv says the time and the length apart; the store holds the other, reset with each track.
      case AUDIO_EVENTS.time:
        return engine.time({ position: event.time, duration: useAudioQueue.getState().duration })
      case AUDIO_EVENTS.duration:
        return engine.time({
          position: useAudioQueue.getState().position,
          duration: event.duration,
        })
      case AUDIO_EVENTS.paused:
        return engine.state(event.paused ? AUDIO_STATES.paused : AUDIO_STATES.playing)
      case AUDIO_EVENTS.waiting:
        if (event.waiting) engine.state(AUDIO_STATES.loading)
        return
      case AUDIO_EVENTS.advanced:
        return host.advanced()
      case AUDIO_EVENTS.ended:
        return host.ended()
      case AUDIO_EVENTS.error:
        return engine.failed(event.message)
      case AUDIO_EVENTS.remote:
        return runRemoteCommand(event.command)
      default: {
        const unreachable: never = event
        return unreachable
      }
    }
  })

  useEffect(() => player.subscribe((event) => onEvent(event)), [player])

  // What the system shows: the words at once, the cover once its bytes have come.
  const showTrack = useEffectEvent((isCurrent: () => boolean) => {
    if (track === null) return
    const words = { title: track.title, artist: artistNames(track), album: track.album.title }
    const send = (artwork: ArrayBuffer | null) =>
      player.send({ type: AUDIO_COMMANDS.nowPlaying, info: { ...words, artwork } })
    send(null).catch(() => undefined)
    artworkOf({ api, track })
      .then((artwork) => {
        if (!isCurrent() || artwork === null) return
        return send(artwork)
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
