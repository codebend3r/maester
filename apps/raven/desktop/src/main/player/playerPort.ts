import {
  type Guard,
  type Infer,
  isNumber,
  isPlayerReply,
  PLAYER_REFUSAL_REASONS,
} from '@raven/core'
import type { PlayerOutcome } from '@/main/player/outcomes'
import { PLAYER_MESSAGES } from '@/main/player/playerMessages'
import { messageOf } from '@/shared/messageOf'

/** The few things the bridge needs of a `MessagePortMain`, so `bun test` can hand it a fake. */
export type PortLike = {
  onMessage: (listener: (data: unknown) => void) => void
  onClose: (listener: () => void) => void
  post: (message: unknown) => void
  start: () => void
  close: () => void
}

export const UNKNOWN_COMMAND = 'Raven does not understand that command.'
const BUSY = 'Raven is busy. Try again.'

/** Requests waiting or in flight before the port refuses more; the page never needs this many. */
export const MAX_PENDING = 100

/** A request on a port: a command of the service's kind, under an id its reply carries back. */
export type PortRequest<C> = { id: number; command: C }
type PlayerReply = Infer<typeof isPlayerReply>

/** What a port drives: the video player's service, or the music engine's. */
export type PortService<C, E> = {
  handle: (command: C) => Promise<PlayerOutcome>
  subscribe: (listener: (event: E) => void) => () => void
  reset: () => Promise<void>
}

type RefusalProps = { id: number; message: string }

const refusal = ({ id, message }: RefusalProps): PlayerReply => ({
  id,
  ok: false,
  reason: PLAYER_REFUSAL_REASONS.refused,
  message,
})

const idOf = (data: unknown): number | null => {
  if (typeof data !== 'object' || data === null || !('id' in data)) return null
  return isNumber(data.id) ? data.id : null
}

type ConnectPortProps<C extends { type: string }, E> = {
  port: PortLike
  service: PortService<C, E>
  /** What a message must pass to reach the service: `isPlayerRequest`, or the music port's. */
  isRequest: Guard<PortRequest<C>>
  warn: (message: string) => void
}

/**
 * One page's port to a service. Only a request that passes `isRequest` reaches the
 * service, one at a time in arrival order, and only its narrowed command goes on.
 */
export const connectPort = <C extends { type: string }, E>({
  port,
  service,
  isRequest,
  warn,
}: ConnectPortProps<C, E>): { close: () => void } => {
  // `isRefusing` quiets the warnings for a run of messages it cannot use, as
  // `isOverflowing` does for a run of commands past `MAX_PENDING`: one warning per run.
  const state = { isOpen: true, pending: 0, isOverflowing: false, isRefusing: false }
  let queue: Promise<void> = Promise.resolve()

  const post = (message: unknown) => {
    if (!state.isOpen) return
    try {
      port.post(message)
    } catch (error) {
      warn(`Raven could not post to the page: ${messageOf(error)}`)
    }
  }

  const unsubscribe = service.subscribe(post)

  const outcomeOf = async ({ id, command }: PortRequest<C>): Promise<PlayerReply> => {
    try {
      const outcome = await service.handle(command)
      if (outcome.ok) return { id, ok: true }
      return { id, ok: false, reason: outcome.reason, message: outcome.message }
    } catch (error) {
      warn(`Raven failed a ${command.type} command: ${messageOf(error)}`)
      return refusal({ id, message: PLAYER_MESSAGES.failed })
    }
  }

  const answer = async (request: PortRequest<C>) => {
    // Work queued before the port closed is dropped, not run against the next page's player.
    if (!state.isOpen) return
    const reply = await outcomeOf(request)
    state.pending -= 1
    if (state.pending < MAX_PENDING) state.isOverflowing = false
    post(reply)
  }

  const enqueue = (request: PortRequest<C>) => {
    if (state.pending >= MAX_PENDING) {
      if (!state.isOverflowing) warn(`Raven refused commands past ${MAX_PENDING} waiting.`)
      state.isOverflowing = true
      post(refusal({ id: request.id, message: BUSY }))
      return
    }
    state.pending += 1
    queue = queue.then(() => answer(request))
  }

  const close = () => {
    if (!state.isOpen) return
    state.isOpen = false
    unsubscribe()
    service.reset().catch((error: unknown) => {
      warn(`Raven could not stop for a closed page: ${messageOf(error)}`)
    })
    port.close()
  }

  const warnRefusing = (message: string) => {
    if (!state.isRefusing) warn(message)
    state.isRefusing = true
  }

  port.onMessage((data) => {
    if (!state.isOpen) return
    if (isRequest(data)) {
      state.isRefusing = false
      enqueue({ id: data.id, command: data.command })
      return
    }
    const id = idOf(data)
    if (id === null) {
      warnRefusing('Raven dropped a player message without a request id.')
      return
    }
    warnRefusing(`Raven refused player request ${id}: it is not a command it knows.`)
    post(refusal({ id, message: UNKNOWN_COMMAND }))
  })
  port.onClose(close)
  port.start()

  return { close }
}
