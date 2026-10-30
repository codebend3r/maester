import {
  type Guard,
  isPlayerReply,
  PLAYER_CONNECTION_STATUSES,
  PLAYER_REFUSAL_REASONS,
  type PlayerConnectionStatus,
} from '@raven/core'

/**
 * A port to one of main's engines as it stands: main's answer, waiting for one, or lost,
 * once the native engine main handed over stopped (unlike unavailable, where the page never
 * had it).
 */
export const CONNECTION_STATUSES = {
  waiting: 'waiting',
  ...PLAYER_CONNECTION_STATUSES,
  lost: 'lost',
} as const

/** The page's end of an engine in main: each command answered once, its events as they come. */
export type Remote<C, E> = {
  send: (command: C) => Promise<void>
  subscribe: (listener: (event: E) => void) => () => void
}

export type Connection<C, E> =
  | { status: typeof CONNECTION_STATUSES.waiting }
  | { status: typeof CONNECTION_STATUSES.native; player: Remote<C, E> }
  | { status: typeof CONNECTION_STATUSES.unavailable; message: string }
  | { status: typeof CONNECTION_STATUSES.lost; message: string }

export type Connections<C, E> = {
  read: () => Connection<C, E>
  subscribe: (listener: () => void) => () => void
}

type RendererPort = Pick<MessagePort, 'postMessage' | 'start' | 'close' | 'addEventListener'>

export const REPLY_TIMEOUT_MS = 10_000
export const PLAYER_NO_ANSWER = 'Raven did not answer.'
export const PLAYER_CLOSED = 'Raven closed its connection to this page.'
/** Longer than main waits on its engine (`OPEN_MS`, 5 s), so main's answer normally comes first. */
const PLAYER_WAIT_MS = 8000

type Pending = {
  resolve: () => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

type PlayerRefusalProps = { message: string; isEngineGone: boolean }

/** A command the engine did not carry out, and whether its native engine is gone for good. */
export class PlayerRefusal extends Error {
  readonly isEngineGone: boolean

  constructor({ message, isEngineGone }: PlayerRefusalProps) {
    super(message)
    this.name = 'PlayerRefusal'
    this.isEngineGone = isEngineGone
  }
}

/** A refusal that means the native engine is gone for good: main said it stopped, or the port closed. */
export const isEngineGone = (error: unknown): error is PlayerRefusal =>
  error instanceof PlayerRefusal && error.isEngineGone

type RemoteOverProps<E> = {
  port: RendererPort
  timeoutMs: number
  /** What an event must pass to reach the listeners: the player's events, or the music engine's. */
  isEvent: Guard<E>
}

/**
 * The page's end of one of main's ports: each command is answered once by the
 * reply with its id, or rejected on a refusal, a timeout or the port closing.
 */
export const remoteOver = <C, E>({
  port,
  timeoutMs,
  isEvent,
}: RemoteOverProps<E>): Remote<C, E> & { close: () => void } => {
  const pending = new Map<number, Pending>()
  const listeners = new Set<(event: E) => void>()
  const state = { nextId: 0, isOpen: true }

  const take = (id: number): Pending | null => {
    const entry = pending.get(id)
    if (entry === undefined) return null
    clearTimeout(entry.timer)
    pending.delete(id)
    return entry
  }

  type FailProps = {
    id: number
    message: string
    isEngineGone: boolean
  }

  const fail = ({ id, message, isEngineGone: isGone }: FailProps) => {
    const entry = take(id)
    if (entry !== null) entry.reject(new PlayerRefusal({ message, isEngineGone: isGone }))
  }

  const shut = () => {
    if (!state.isOpen) return
    state.isOpen = false
    Array.from(pending.keys()).forEach((id) =>
      fail({ id, message: PLAYER_CLOSED, isEngineGone: true }),
    )
    listeners.clear()
  }

  port.addEventListener('message', (event) => {
    const { data } = event
    if (isPlayerReply(data)) {
      const entry = take(data.id)
      // A reply after its timeout, or to an id this page never sent.
      if (entry === null) {
        console.warn(`Raven dropped a reply to request ${data.id}, which is not waiting.`)
        return
      }
      if (data.ok) {
        entry.resolve()
        return
      }
      entry.reject(
        new PlayerRefusal({
          message: data.message,
          isEngineGone: data.reason === PLAYER_REFUSAL_REASONS.engine,
        }),
      )
      return
    }
    if (isEvent(data)) {
      listeners.forEach((listener) => listener(data))
      return
    }
    console.warn('Raven ignored a player message it does not understand.')
  })
  // Main closing its end (on a reload or a second `ready`) fails what is still waiting.
  port.addEventListener('close', shut)
  port.start()

  return {
    send: (command) => {
      if (!state.isOpen) {
        return Promise.reject(new PlayerRefusal({ message: PLAYER_CLOSED, isEngineGone: true }))
      }
      state.nextId += 1
      const id = state.nextId
      return new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => fail({ id, message: PLAYER_NO_ANSWER, isEngineGone: false }),
          timeoutMs,
        )
        pending.set(id, { resolve, reject, timer })
        port.postMessage({ id, command })
      })
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    close: () => {
      shut()
      port.close()
    },
  }
}

const WAITING = { status: CONNECTION_STATUSES.waiting } as const

type PortMessage = { type: string; connection: PlayerConnectionStatus }

type ListenForPortProps<E> = {
  target: Pick<Window, 'addEventListener' | 'removeEventListener'>
  origin: string
  waitMs?: number
  /** The preload's hand-over message for this engine: the player's, or the music engine's. */
  isPortMessage: Guard<PortMessage>
  isEvent: Guard<E>
  /** The event main sends once when the engine stops under the page. */
  isEngineStop: (event: E) => event is E & { message: string }
  /** The page's words when main never answered. */
  notHanded: string
}

/**
 * Waits for the preload to hand over one of main's engines. Only a message posted to this
 * window on the app's origin, with exactly the ports its connection carries, is taken. The
 * `event.source` check stops posts from other windows and frames; it is not proof the
 * preload sent the message, since the page's own scripts post as this window too. The
 * real boundary is main: its request guard on every port message and the service's
 * allowlist behind it, so a port the page forged reaches nothing. The first answer, or
 * `waitMs` passing with none, settles which engine the page plays through, so nothing changes
 * engine mid-play: a later hand-over is ignored and its port closed. The one way out of native
 * is the engine stopping (mpv gone, or the port closed under it): the connection is then lost.
 */
export const listenForPort = <C, E>({
  target,
  origin,
  waitMs = PLAYER_WAIT_MS,
  isPortMessage,
  isEvent,
  isEngineStop,
  notHanded,
}: ListenForPortProps<E>): Connections<C, E> & { dispose: () => void } => {
  const listeners = new Set<() => void>()
  let connection: Connection<C, E> = WAITING
  let opened: ReturnType<typeof remoteOver<C, E>> | null = null

  const become = (next: Connection<C, E>) => {
    clearTimeout(deadline)
    connection = next
    listeners.forEach((listener) => listener())
  }

  const lose = (message: string) => {
    if (connection.status !== CONNECTION_STATUSES.native || opened === null) return
    const gone = opened
    opened = null
    become({ status: CONNECTION_STATUSES.lost, message })
    // After the listeners still to hear this event (the page among them) have heard it.
    queueMicrotask(gone.close)
  }

  const watched = (player: ReturnType<typeof remoteOver<C, E>>): Remote<C, E> => {
    player.subscribe((event) => {
      if (isEngineStop(event)) lose(event.message)
    })
    return {
      send: (command) =>
        player.send(command).catch((error: unknown) => {
          if (isEngineGone(error)) lose(error.message)
          throw error
        }),
      subscribe: player.subscribe,
    }
  }

  const deadline = setTimeout(() => {
    if (connection.status !== CONNECTION_STATUSES.waiting) return
    become({ status: CONNECTION_STATUSES.unavailable, message: notHanded })
  }, waitMs)

  const onMessage = (event: MessageEvent) => {
    if (event.origin !== origin || event.source !== target) return
    const { data, ports } = event
    if (!isPortMessage(data)) return
    if (connection.status !== CONNECTION_STATUSES.waiting) {
      // Main stops what it drives over a port it sees closed.
      ports.forEach((port) => port.close())
      return
    }
    const { connection: offered } = data
    switch (offered.status) {
      case PLAYER_CONNECTION_STATUSES.native: {
        const [port] = ports
        if (port === undefined || ports.length !== 1) return
        opened = remoteOver<C, E>({ port, timeoutMs: REPLY_TIMEOUT_MS, isEvent })
        become({ status: CONNECTION_STATUSES.native, player: watched(opened) })
        return
      }
      case PLAYER_CONNECTION_STATUSES.unavailable:
        if (ports.length !== 0) return
        become({ status: CONNECTION_STATUSES.unavailable, message: offered.message })
        return
      default: {
        const unreachable: never = offered
        return unreachable
      }
    }
  }
  target.addEventListener('message', onMessage)

  return {
    read: () => connection,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    dispose: () => {
      clearTimeout(deadline)
      target.removeEventListener('message', onMessage)
      listeners.clear()
      if (opened !== null) opened.close()
      opened = null
    },
  }
}
