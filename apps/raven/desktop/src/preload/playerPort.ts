import {
  isPlayerConnection,
  PLAYER_CONNECTION_STATUSES,
  type PlayerConnectionStatus,
  WINDOW_MESSAGE_TYPES,
} from '@raven/core'

/** Which hand-over a message is: the video player's port, or the music engine's. */
type PortMessageType = (typeof WINDOW_MESSAGE_TYPES)[keyof typeof WINDOW_MESSAGE_TYPES]

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
  /** `playerPort` for the video player's hand-over, `audioPort` for the music engine's. */
  type: PortMessageType
  post: (input: PostProps) => void
}

/**
 * Passes main's player hand-over to the page. Main sends it only in answer to the
 * page's `ready`, so the page's listener is already installed. Only a known
 * connection with the ports it should carry goes on, rebuilt from its known fields.
 */
export const forwardPlayerPort = ({ payload, ports, type, post }: ForwardPlayerPortProps): void => {
  if (!isPlayerConnection(payload)) return
  if (ports.length !== PORTS_FOR[payload.status]) return
  post({
    message: { type, connection: rebuild(payload) },
    transfer: [...ports],
  })
}
