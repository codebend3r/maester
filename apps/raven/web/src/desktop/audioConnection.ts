import {
  type AudioCommand,
  type AudioEvent,
  isAudioEvent,
  isAudioPortMessage,
  isEngineStopEvent,
} from '@raven/core'
import { useSyncExternalStore } from 'react'
import {
  type Connection,
  type Connections,
  listenForPort,
  type Remote,
} from '@/desktop/portConnection'
import { useDesktop, useDesktopBridge } from '@/stores/desktop'

/** The page's end of main's music engine. */
export type NativeAudio = Remote<AudioCommand, AudioEvent>
export type AudioConnection = Connection<AudioCommand, AudioEvent>
export type AudioConnections = Connections<AudioCommand, AudioEvent>

export const AUDIO_NOT_HANDED =
  'Raven could not reach its music engine, so music plays through Chromium.'

type ListenForAudioProps = {
  target: Pick<Window, 'addEventListener' | 'removeEventListener'>
  origin: string
  waitMs?: number
}

/** Waits for the preload to hand over main's music engine; see `listenForPort`. */
export const listenForAudio = ({
  target,
  origin,
  waitMs,
}: ListenForAudioProps): AudioConnections & { dispose: () => void } =>
  listenForPort<AudioCommand, AudioEvent>({
    target,
    origin,
    waitMs,
    isPortMessage: isAudioPortMessage,
    isEvent: isAudioEvent,
    isEngineStop: isEngineStopEvent,
    notHanded: AUDIO_NOT_HANDED,
  })

/** The page's music engine connection, read through the desktop bridge's store. */
export const useAudioConnection = (): AudioConnection => {
  const { audio } = useDesktop()
  return useSyncExternalStore(audio.subscribe, audio.read)
}

const subscribeToNothing = () => () => undefined

/**
 * How the connection to the music engine stands, for what renders in a browser too: null there,
 * since a browser has no engine but its own.
 */
export const useAudioConnectionStatus = (): AudioConnection['status'] | null => {
  const audio = useDesktopBridge((state) => state.desktop?.audio ?? null)
  return useSyncExternalStore(
    audio?.subscribe ?? subscribeToNothing,
    () => audio?.read().status ?? null,
  )
}
