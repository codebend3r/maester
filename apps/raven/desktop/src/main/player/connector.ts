import { PLAYER_CONNECTION_STATUSES, type PlayerConnectionStatus } from '@raven/core'
import { ENGINE_MESSAGES, ENGINE_STATUSES, type OpenedEngine } from '@/main/player/engine'
import { connectPort, type PortLike } from '@/main/player/playerPort'
import type { PlayerService } from '@/main/player/playerService'
import type { Timers } from '@/main/stateStore'
import { messageOf } from '@/shared/messageOf'

/**
 * How long a page waits on the engine before it is told to use the html engine. The
 * engine keeps opening, so the next page load (a reload) can still get it.
 */
export const OPEN_MS = 5000

const UNAVAILABLE = {
  status: ENGINE_STATUSES.unavailable,
  message: ENGINE_MESSAGES.unavailable,
} as const satisfies OpenedEngine<never>

/**
 * Hands each page load its player: on every `ready`, the old port is closed (which
 * stops playback) before a new one is made, so two ports never drive one engine.
 * `R` is the far end's type (Electron's `MessagePortMain`), passed on untouched.
 */
export const createConnector = <T extends { service: PlayerService }, R>({
  engine,
  channel,
  post,
  warn,
  timers,
}: {
  engine: () => Promise<OpenedEngine<T>>
  channel: () => { local: PortLike; remote: R }
  post: (input: { connection: PlayerConnectionStatus; ports: R[] }) => void
  warn: (message: string) => void
  timers: Timers
}): { connect: () => Promise<void>; disconnect: () => void } => {
  let current: { close: () => void } | null = null
  // Bumped by every connect and disconnect, so an engine that opens late hands over nothing.
  let generation = 0

  const disconnect = () => {
    generation += 1
    if (current === null) return
    current.close()
    current = null
  }

  const open = async (): Promise<OpenedEngine<T>> => {
    try {
      return await engine()
    } catch (error) {
      warn(`raven player could not open its video engine: ${messageOf(error)}`)
      return UNAVAILABLE
    }
  }

  // An engine that never settles must not leave the page waiting forever.
  const openWithin = (): Promise<OpenedEngine<T>> => {
    const deadline = Promise.withResolvers<OpenedEngine<T>>()
    const timer = timers.set({
      run: () => {
        warn(`raven player's video engine did not open within ${OPEN_MS} ms.`)
        deadline.resolve(UNAVAILABLE)
      },
      ms: OPEN_MS,
    })
    return Promise.race([open(), deadline.promise]).finally(() => timers.clear(timer))
  }

  const hand = ({ opened }: { opened: OpenedEngine<T> }) => {
    switch (opened.status) {
      case ENGINE_STATUSES.unavailable:
        post({
          connection: { status: PLAYER_CONNECTION_STATUSES.unavailable, message: opened.message },
          ports: [],
        })
        return
      case ENGINE_STATUSES.native: {
        const { local, remote } = channel()
        const connection = connectPort({ port: local, service: opened.engine.service, warn })
        current = connection
        try {
          post({ connection: { status: PLAYER_CONNECTION_STATUSES.native }, ports: [remote] })
        } catch (error) {
          warn(`raven player could not hand the page its player: ${messageOf(error)}`)
          connection.close()
          current = null
        }
        return
      }
      default: {
        const unreachable: never = opened
        return unreachable
      }
    }
  }

  const connect = async () => {
    disconnect()
    const mine = generation
    const opened = await openWithin()
    if (mine !== generation) return
    hand({ opened })
  }

  return { connect, disconnect }
}
