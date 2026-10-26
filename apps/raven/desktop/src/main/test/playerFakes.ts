import type { PlayerCommand, PlayerEvent } from '@raven/core'
import type { PortLike } from '@/main/player/playerPort'
import type {
  AccountRefusalReader,
  FailureExplainer,
  PlayerOutcome,
  PlayerService,
  ResolvedSource,
} from '@/main/player/playerService'
import type { Timers } from '@/main/stateStore'

const OK: PlayerOutcome = { ok: true }

const NO_SERVERS_MESSAGE = 'This player knows no servers.'

/** Server sources for a player that knows no servers: every server title is refused. */
export const NO_SERVERS = {
  resolve: async (): Promise<ResolvedSource> => ({ ok: false, message: NO_SERVERS_MESSAGE }),
}

/** A player whose server titles were never refused an account. */
export const noRefusedAccount: AccountRefusalReader = () => null

/** An explainer for a player that never opens a server title. */
export const noExplanation: FailureExplainer = async () => {
  throw new Error(NO_SERVERS_MESSAGE)
}

/** Timers that run only when the test fires them; `pending` holds what is set and not cleared. */
export const fakeTimers = () => {
  const pending = new Map<number, { run: () => void; ms: number }>()
  const counter = { next: 1 }
  const timers: Timers = {
    set: ({ run, ms }) => {
      const handle = counter.next
      counter.next += 1
      pending.set(handle, { run, ms })
      return handle
    },
    clear: (handle) => {
      if (typeof handle === 'number') pending.delete(handle)
    },
  }
  const fire = () => {
    const due = [...pending.values()]
    pending.clear()
    due.forEach((timer) => timer.run())
  }
  return { timers, fire, pending }
}

type FakePortProps = { log?: string[] }

/** A port whose posts are recorded; `send` delivers a message and `fireClose` closes the far end. */
export const fakePort = ({ log = [] }: FakePortProps = {}) => {
  const posted: unknown[] = []
  const messageListeners: ((data: unknown) => void)[] = []
  const closeListeners: (() => void)[] = []
  const flags = { isStarted: false, closes: 0 }
  const port: PortLike = {
    onMessage: (listener) => {
      messageListeners.push(listener)
    },
    onClose: (listener) => {
      closeListeners.push(listener)
    },
    post: (message) => {
      posted.push(message)
    },
    start: () => {
      flags.isStarted = true
    },
    close: () => {
      log.push('close')
      flags.closes += 1
    },
  }
  return {
    port,
    posted,
    flags,
    send: (data: unknown) => messageListeners.forEach((listener) => listener(data)),
    fireClose: () => closeListeners.forEach((listener) => listener()),
  }
}

type FakeServiceProps = { outcome?: (command: PlayerCommand) => PlayerOutcome; log?: string[] }

/** A service that records `handle`; `deferNext` holds the next answer until `release`. */
export const fakeService = ({ outcome = () => OK, log = [] }: FakeServiceProps = {}) => {
  const handled: PlayerCommand[] = []
  const listeners = new Set<(event: PlayerEvent) => void>()
  const held: (() => void)[] = []
  const flags = { shouldDefer: false, resets: 0, isDead: false }
  const service: PlayerService = {
    handle: async (command) => {
      handled.push(command)
      if (flags.shouldDefer) {
        flags.shouldDefer = false
        await new Promise<void>((resolve) => {
          held.push(resolve)
        })
      }
      return outcome(command)
    },
    receive: () => {},
    isDead: () => flags.isDead,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    reset: async () => {
      log.push('reset')
      flags.resets += 1
    },
    dispose: () => {},
    applyOutput: async () => {},
    applyDisplay: async () => {},
  }
  return {
    service,
    handled,
    flags,
    deferNext: () => {
      flags.shouldDefer = true
    },
    release: () => {
      const next = held.shift()
      if (next) next()
    },
    emit: (event: PlayerEvent) => listeners.forEach((listener) => listener(event)),
    listenerCount: () => listeners.size,
  }
}
