import { type Guard, PLAYER_CONNECTION_STATUSES, type PlayerConnectionStatus } from '@raven/core'
import { BOUNDED_OUTCOMES, within } from '@/main/bounded'
import { ENGINE_STATUSES, type OpenedEngine } from '@/main/player/engine'
import {
  connectPort,
  type PortLike,
  type PortRequest,
  type PortService,
} from '@/main/player/playerPort'
import type { Timers } from '@/main/stateStore'
import { messageOf } from '@/shared/messageOf'

/**
 * How long a page waits on the engine before it is told to use the html engine. The
 * engine keeps opening, so the next page load (a reload) can still get it.
 */
export const OPEN_MS = 5000

type PostProps<R> = { connection: PlayerConnectionStatus; ports: R[] }

type CreateConnectorProps<
  C extends { type: string },
  E,
  T extends { service: PortService<C, E> },
  R,
> = {
  engine: () => Promise<OpenedEngine<T>>
  isRequest: Guard<PortRequest<C>>
  channel: () => { local: PortLike; remote: R }
  post: (input: PostProps<R>) => void
  /** What a page is told when the engine could not open or did not open in time. */
  unavailable: string
  warn: (message: string) => void
  timers: Timers
}

/**
 * Hands each page load its player: on every `ready`, the old port is closed (which
 * stops playback) before a new one is made, so two ports never drive one engine.
 * `R` is the far end's type (Electron's `MessagePortMain`), passed on untouched.
 */
export const createConnector = <
  C extends { type: string },
  E,
  T extends { service: PortService<C, E> },
  R,
>({
  engine,
  isRequest,
  channel,
  post,
  unavailable,
  warn,
  timers,
}: CreateConnectorProps<C, E, T, R>): { connect: () => Promise<void>; disconnect: () => void } => {
  const UNAVAILABLE = {
    status: ENGINE_STATUSES.unavailable,
    message: unavailable,
  } as const satisfies OpenedEngine<never>
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
      warn(`Raven could not open its video engine: ${messageOf(error)}`)
      return UNAVAILABLE
    }
  }

  // An engine that never settles must not leave the page waiting forever.
  const openWithin = async (): Promise<OpenedEngine<T>> => {
    const bounded = await within({ task: open(), ms: OPEN_MS, timers })
    switch (bounded.outcome) {
      case BOUNDED_OUTCOMES.answered:
        return bounded.result
      case BOUNDED_OUTCOMES.late:
        warn(`Raven's video engine did not open within ${OPEN_MS} ms.`)
        return UNAVAILABLE
      case BOUNDED_OUTCOMES.failed:
        throw bounded.error
      default: {
        const unreachable: never = bounded
        return unreachable
      }
    }
  }

  type HandProps = { opened: OpenedEngine<T> }

  const hand = ({ opened }: HandProps) => {
    switch (opened.status) {
      case ENGINE_STATUSES.unavailable:
        post({
          connection: { status: PLAYER_CONNECTION_STATUSES.unavailable, message: opened.message },
          ports: [],
        })
        return
      case ENGINE_STATUSES.native: {
        const { local, remote } = channel()
        const connection = connectPort({
          port: local,
          service: opened.engine.service,
          isRequest,
          warn,
        })
        current = connection
        try {
          post({ connection: { status: PLAYER_CONNECTION_STATUSES.native }, ports: [remote] })
        } catch (error) {
          warn(`Raven could not hand the page its player: ${messageOf(error)}`)
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
