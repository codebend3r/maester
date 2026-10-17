import { isPlayerEvent, isPlayerReply, type PlayerEvent } from '@raven/core'
import type { NativePlayer } from '@raven/ui'
import { useSyncExternalStore } from 'react'
import { useDesktop } from '@/renderer/stores/desktop'
import { isPlayerPortMessage, PLAYER_CONNECTION_STATUSES } from '@/shared/protocol'

/** The page's player as it stands: main's answer, or waiting for one. */
export const CONNECTION_STATUSES = { waiting: 'waiting', ...PLAYER_CONNECTION_STATUSES } as const

export type PlayerConnection =
  | { status: 'waiting' }
  | { status: 'native'; player: NativePlayer }
  | { status: 'unavailable'; message: string }

export type PlayerConnections = {
  read: () => PlayerConnection
  subscribe: (listener: () => void) => () => void
}

export type RendererPort = Pick<MessagePort, 'postMessage' | 'start' | 'close' | 'addEventListener'>

export const REPLY_TIMEOUT_MS = 10_000
export const PLAYER_NO_ANSWER = 'raven player did not answer.'
export const PLAYER_CLOSED = 'raven player closed its connection to this page.'
export const PLAYER_NOT_HANDED =
  'raven player could not reach its video engine, so it plays only the videos Chromium can.'
/** Longer than main waits on its engine (`OPEN_MS`, 5 s), so main's answer normally comes first. */
export const PLAYER_WAIT_MS = 8000

type Pending = {
  resolve: () => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

/** A command the player did not carry out, and whether its native engine is gone for good. */
export class PlayerRefusal extends Error {
  readonly isEngineGone: boolean

  constructor({ message, isEngineGone }: { message: string; isEngineGone: boolean }) {
    super(message)
    this.name = 'PlayerRefusal'
    this.isEngineGone = isEngineGone
  }
}

/**
 * The page's end of main's player port: each command is answered once by the
 * reply with its id, or rejected on a refusal, a timeout or the port closing.
 */
export const nativePlayerOver = ({
  port,
  timeoutMs,
}: {
  port: RendererPort
  timeoutMs: number
}): NativePlayer & { close: () => void } => {
  const pending = new Map<number, Pending>()
  const listeners = new Set<(event: PlayerEvent) => void>()
  const state = { nextId: 0, isOpen: true }

  const take = (id: number): Pending | null => {
    const entry = pending.get(id)
    if (entry === undefined) return null
    clearTimeout(entry.timer)
    pending.delete(id)
    return entry
  }

  const fail = ({
    id,
    message,
    isEngineGone,
  }: {
    id: number
    message: string
    isEngineGone: boolean
  }) => {
    const entry = take(id)
    if (entry !== null) entry.reject(new PlayerRefusal({ message, isEngineGone }))
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
        console.warn(`raven player dropped a reply to request ${data.id}, which is not waiting.`)
        return
      }
      if (data.ok) {
        entry.resolve()
        return
      }
      entry.reject(
        new PlayerRefusal({ message: data.message, isEngineGone: data.reason === 'engine' }),
      )
      return
    }
    if (isPlayerEvent(data)) {
      listeners.forEach((listener) => listener(data))
      return
    }
    console.warn('raven player ignored a player message it does not understand.')
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

const WAITING: PlayerConnection = { status: 'waiting' }

/** A refusal that means the native engine is gone for good: main said mpv stopped, or the port closed. */
export const isEngineGone = (error: unknown): error is PlayerRefusal =>
  error instanceof PlayerRefusal && error.isEngineGone

/** The event main sends once when mpv stops under the page. */
export const isEngineStop = (
  event: PlayerEvent,
): event is Extract<PlayerEvent, { type: 'error' }> =>
  event.type === 'error' && event.reason === 'engine'

/**
 * Waits for the preload to hand over main's player. Only a message posted to this window
 * on the app's origin, with exactly the ports its connection carries, is taken. The
 * `event.source` check stops posts from other windows and frames; it is not proof the
 * preload sent the message, since the page's own scripts post as this window too. The
 * real boundary is main: `isPlayerRequest` on every port message and the service's
 * allowlist behind it, so a port the page forged reaches nothing. The first answer, or
 * `waitMs` passing with none, settles which engine the page plays through, so a video
 * never changes engine mid-play: a later hand-over is ignored and its port closed. The one way out of native is the engine stopping
 * (mpv gone, or the port closed under it), after which the page uses the html engine.
 */
export const listenForPlayer = ({
  target,
  origin,
  waitMs = PLAYER_WAIT_MS,
}: {
  target: Pick<Window, 'addEventListener' | 'removeEventListener'>
  origin: string
  waitMs?: number
}): PlayerConnections & { dispose: () => void } => {
  const listeners = new Set<() => void>()
  let connection: PlayerConnection = WAITING
  let opened: ReturnType<typeof nativePlayerOver> | null = null

  const become = (next: PlayerConnection) => {
    clearTimeout(deadline)
    connection = next
    listeners.forEach((listener) => listener())
  }

  const lose = (message: string) => {
    if (connection.status !== 'native' || opened === null) return
    const gone = opened
    opened = null
    become({ status: 'unavailable', message })
    // After the listeners still to hear this event (the page among them) have heard it.
    queueMicrotask(gone.close)
  }

  const watched = (player: ReturnType<typeof nativePlayerOver>): NativePlayer => {
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
    if (connection.status !== 'waiting') return
    become({ status: 'unavailable', message: PLAYER_NOT_HANDED })
  }, waitMs)

  const onMessage = (event: MessageEvent) => {
    if (event.origin !== origin || event.source !== target) return
    const { data, ports } = event
    if (!isPlayerPortMessage(data)) return
    if (connection.status !== 'waiting') {
      // Main stops what it drives over a port it sees closed.
      ports.forEach((port) => port.close())
      return
    }
    const { connection: offered } = data
    switch (offered.status) {
      case 'native': {
        const [port] = ports
        if (port === undefined || ports.length !== 1) return
        opened = nativePlayerOver({ port, timeoutMs: REPLY_TIMEOUT_MS })
        become({ status: 'native', player: watched(opened) })
        return
      }
      case 'unavailable':
        if (ports.length !== 0) return
        become({ status: 'unavailable', message: offered.message })
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

/** The page's player connection, read through the desktop bridge's store. */
export const usePlayerConnection = (): PlayerConnection => {
  const { player } = useDesktop()
  return useSyncExternalStore(player.subscribe, player.read)
}
