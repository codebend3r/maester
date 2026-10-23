import {
  type Infer,
  isNumber,
  isPlayerReply,
  isPlayerRequest,
  PLAYER_REFUSAL_REASONS,
} from '@raven/core'
import { PLAYER_MESSAGES, type PlayerService } from '@/main/player/playerService'
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

type PlayerRequest = Infer<typeof isPlayerRequest>
type PlayerReply = Infer<typeof isPlayerReply>

const refusal = ({ id, message }: { id: number; message: string }): PlayerReply => ({
  id,
  ok: false,
  reason: PLAYER_REFUSAL_REASONS.refused,
  message,
})

const idOf = (data: unknown): number | null => {
  if (typeof data !== 'object' || data === null || !('id' in data)) return null
  return isNumber(data.id) ? data.id : null
}

/**
 * One page's player port. Only a request that passes `isPlayerRequest` reaches the
 * service, one at a time in arrival order, and only its narrowed command goes on.
 */
export const connectPort = ({
  port,
  service,
  warn,
}: {
  port: PortLike
  service: PlayerService
  warn: (message: string) => void
}): { close: () => void } => {
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

  const outcomeOf = async ({ id, command }: PlayerRequest): Promise<PlayerReply> => {
    try {
      const outcome = await service.handle(command)
      if (outcome.ok) return { id, ok: true }
      return { id, ok: false, reason: outcome.reason, message: outcome.message }
    } catch (error) {
      warn(`Raven failed a ${command.type} command: ${messageOf(error)}`)
      return refusal({ id, message: PLAYER_MESSAGES.failed })
    }
  }

  const answer = async (request: PlayerRequest) => {
    // Work queued before the port closed is dropped, not run against the next page's player.
    if (!state.isOpen) return
    const reply = await outcomeOf(request)
    state.pending -= 1
    if (state.pending < MAX_PENDING) state.isOverflowing = false
    post(reply)
  }

  const enqueue = (request: PlayerRequest) => {
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
    if (isPlayerRequest(data)) {
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
