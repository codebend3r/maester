import {
  isPlayerConnection,
  PLAYER_CONNECTION_STATUSES,
  type PlayerConnectionStatus,
  WINDOW_MESSAGE_TYPES,
} from '@raven/core'

const rebuild = (connection: PlayerConnectionStatus): PlayerConnectionStatus => {
  switch (connection.status) {
    case PLAYER_CONNECTION_STATUSES.native:
      return { status: PLAYER_CONNECTION_STATUSES.native }
    case PLAYER_CONNECTION_STATUSES.unavailable:
      return { status: PLAYER_CONNECTION_STATUSES.unavailable, message: connection.message }
    default: {
      const unreachable: never = connection
      return unreachable
    }
  }
}

const PORTS_FOR = { native: 1, unavailable: 0 } as const satisfies Record<
  PlayerConnectionStatus['status'],
  number
>

type PostProps = { message: unknown; transfer: MessagePort[] }

type ForwardPlayerPortProps = {
  payload: unknown
  ports: readonly MessagePort[]
  post: (input: PostProps) => void
}

/**
 * Passes main's player hand-over to the page. Main sends it only in answer to the
 * page's `ready`, so the page's listener is already installed. Only a known
 * connection with the ports it should carry goes on, rebuilt from its known fields.
 */
export const forwardPlayerPort = ({ payload, ports, post }: ForwardPlayerPortProps): void => {
  if (!isPlayerConnection(payload)) return
  if (ports.length !== PORTS_FOR[payload.status]) return
  post({
    message: { type: WINDOW_MESSAGE_TYPES.playerPort, connection: rebuild(payload) },
    transfer: [...ports],
  })
}
