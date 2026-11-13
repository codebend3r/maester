import type { PlayerCommand, PlayerEvent } from '@raven/core'
import {
  MPV_EVENTS,
  type MpvEvent,
  type MpvProperty,
  type MpvPropertyValue,
  type MpvReply,
  type NowPlaying,
  propertyGuards,
} from '@raven/mpv'
import type { AudioMpv } from '@/main/player/audioService'
import type { PortLike } from '@/main/player/playerPort'
import type {
  AccountRefusalReader,
  FailureExplainer,
  ResolvedServerSource,
} from '@/main/player/loadTarget'
import { OK, type PlayerOutcome } from '@/main/player/outcomes'
import type { PlayerService } from '@/main/player/playerService'
import type { Timers } from '@/main/timers'

const NO_SERVERS_MESSAGE = 'This player knows no servers.'

/** Server sources for a player that knows no servers: every server title is refused. */
export const NO_SERVERS = {
  resolve: async (): Promise<ResolvedServerSource> => ({ ok: false, message: NO_SERVERS_MESSAGE }),
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

const isValueOf =
  <K extends MpvProperty>(name: K) =>
  (value: unknown): value is MpvPropertyValue<K> =>
    propertyGuards[name](value)

type HeldCall = {
  entry: string
  resolve: () => void
  reject: (error: Error) => void
  onReply: (reply: MpvReply) => void
}

const ignoreReply = () => {}

type ReplyProps = { entry: string; onReply?: (reply: MpvReply) => void }

type FakeReadProps<K extends MpvProperty> = { name: K }

type CreateFakeMpvProps = {
  /** What each read answers; a read of anything else, or of a value its guard refuses, fails. */
  values?: ReadonlyMap<string, unknown>
}

/**
 * A scripted mpv for the video and music services: every call is logged and answers
 * asynchronously, unless a prefix in `failing` fails it or `hold` keeps it until released. It
 * rejects what is in flight the way the wrapper does on destroy and shutdown, runs `onReply` as
 * each reply arrives, and records what the system's Now Playing was told.
 */
export const createFakeMpv = ({ values: initial = new Map() }: CreateFakeMpvProps = {}) => {
  const log: string[] = []
  const reads: string[] = []
  // Every command's arguments as sent, and every call in the order it was made, reads too.
  const commands: (readonly string[])[] = []
  const timeline: string[] = []
  const observed: string[] = []
  const shown: (NowPlaying | null)[] = []
  const values = new Map<string, unknown>(initial)
  const held: HeldCall[] = []
  const failing = new Set<string>()
  const flags: { holding: string | null; isDestroyed: boolean } = {
    holding: null,
    isDestroyed: false,
  }
  const sink: { receive: (event: MpvEvent) => void } = { receive: () => {} }

  // Like the wrapper: `onReply` runs as the reply arrives, told whether mpv accepted it.
  const answer = ({ entry, resolve, reject, onReply }: HeldCall) => {
    const isFailing = [...failing].some((prefix) => entry.startsWith(prefix))
    onReply({ isOk: !isFailing })
    if (isFailing) {
      reject(new Error('mpv request failed (-12)'))
      return
    }
    resolve()
  }

  const reply = ({ entry, onReply = ignoreReply }: ReplyProps) =>
    new Promise<void>((resolve, reject) => {
      if (flags.isDestroyed) {
        reject(new Error('mpv is destroyed'))
        return
      }
      if (flags.holding !== null && entry.startsWith(flags.holding)) {
        held.push({ entry, resolve, reject, onReply })
        return
      }
      answer({ entry, resolve, reject, onReply })
    })

  const rejectHeld = (message: string) => {
    held.splice(0).forEach((request) => request.reject(new Error(message)))
  }

  /** Answers only what is held for calls starting with `prefix`, and goes on holding. */
  const releaseOnly = (prefix: string) => {
    const due = held.filter(({ entry }) => entry.startsWith(prefix))
    const kept = held.filter(({ entry }) => !entry.startsWith(prefix))
    held.splice(0, held.length, ...kept)
    due.forEach(answer)
  }

  const control: AudioMpv = {
    command: async ({ args, onReply }) => {
      const entry = args.join(' ')
      log.push(entry)
      commands.push(args)
      timeline.push(entry)
      await reply({ entry, onReply })
    },
    set: async ({ name, value }) => {
      const entry = `set ${name} ${String(value)}`
      log.push(entry)
      timeline.push(entry)
      await reply({ entry })
    },
    read: async <K extends MpvProperty>({ name }: FakeReadProps<K>) => {
      reads.push(name)
      timeline.push(`read ${name}`)
      await reply({ entry: `read ${name}` })
      const value = values.get(name)
      if (!isValueOf(name)(value)) throw new Error('mpv request failed (-10)')
      return value
    },
    observe: ({ name }) => {
      observed.push(name)
    },
    nowPlaying: (info) => {
      shown.push(info)
    },
    clearNowPlaying: () => {
      shown.push(null)
    },
  }

  return {
    control,
    log,
    reads,
    commands,
    timeline,
    observed,
    shown,
    values,
    failing,
    connect: (receive: (event: MpvEvent) => void) => {
      sink.receive = receive
    },
    emit: (event: MpvEvent) => sink.receive(event),
    /** Holds the replies to calls starting with `prefix`, or to every call, until a release. */
    hold: (prefix = '') => {
      flags.holding = prefix
      return () => {
        flags.holding = null
        releaseOnly(prefix)
      }
    },
    release: () => {
      flags.holding = null
      held.splice(0).forEach(answer)
    },
    releaseOnly,
    /** Answers what is held newest first, as no ordered stream would. */
    releaseNewestFirst: () => {
      flags.holding = null
      held.splice(0).toReversed().forEach(answer)
    },
    failOn: (prefix: string) => {
      failing.add(prefix)
    },
    /** The wrapper's destroy rejects what is in flight and then hears nothing more. */
    destroy: () => {
      flags.isDestroyed = true
      rejectHeld('mpv is destroyed')
    },
    /** The wrapper's shutdown rejects what is in flight, then passes the event on. */
    shutdown: () => {
      rejectHeld('mpv shutdown')
      sink.receive({ type: MPV_EVENTS.shutdown })
    },
  }
}
