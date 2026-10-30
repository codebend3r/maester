import {
  isEngineStopEvent,
  isPlayerEvent,
  isPlayerPortMessage,
  type PlayerCommand,
  type PlayerEvent,
} from '@raven/core'
import type { NativePlayer } from '@raven/ui/headless'
import { useSyncExternalStore } from 'react'
import {
  type Connection,
  type Connections,
  listenForPort,
  REPLY_TIMEOUT_MS,
  remoteOver,
} from '@/desktop/portConnection'
import { useDesktop } from '@/stores/desktop'

export {
  CONNECTION_STATUSES,
  isEngineGone,
  PLAYER_CLOSED,
  PLAYER_NO_ANSWER,
  PlayerRefusal,
} from '@/desktop/portConnection'

export type PlayerConnection = Connection<PlayerCommand, PlayerEvent>
export type PlayerConnections = Connections<PlayerCommand, PlayerEvent>

export const PLAYER_NOT_HANDED =
  'Raven could not reach its video engine, so it plays only the videos Chromium can.'

type NativePlayerOverProps = {
  port: Pick<MessagePort, 'postMessage' | 'start' | 'close' | 'addEventListener'>
  timeoutMs?: number
}

/** The page's end of main's player port. */
export const nativePlayerOver = ({
  port,
  timeoutMs = REPLY_TIMEOUT_MS,
}: NativePlayerOverProps): NativePlayer & { close: () => void } =>
  remoteOver<PlayerCommand, PlayerEvent>({ port, timeoutMs, isEvent: isPlayerEvent })

type ListenForPlayerProps = {
  target: Pick<Window, 'addEventListener' | 'removeEventListener'>
  origin: string
  waitMs?: number
}

/** Waits for the preload to hand over main's video player; see `listenForPort`. */
export const listenForPlayer = ({
  target,
  origin,
  waitMs,
}: ListenForPlayerProps): PlayerConnections & { dispose: () => void } =>
  listenForPort<PlayerCommand, PlayerEvent>({
    target,
    origin,
    waitMs,
    isPortMessage: isPlayerPortMessage,
    isEvent: isPlayerEvent,
    isEngineStop: isEngineStopEvent,
    notHanded: PLAYER_NOT_HANDED,
  })

/** The page's player connection, read through the desktop bridge's store. */
export const usePlayerConnection = (): PlayerConnection => {
  const { player } = useDesktop()
  return useSyncExternalStore(player.subscribe, player.read)
}
