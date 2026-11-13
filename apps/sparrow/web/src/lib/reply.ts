/**
 * A reply as the page shows it, rebuilt from the events its entry keeps: each
 * one read through the stream's guards, then applied in order.
 */
import type { CaseTurn } from '@/lib/api'
import { CHAT_COPY } from '@/lib/copy'
import type { ReplyEntry } from '@/lib/entries'
import {
  CHAT_EVENTS,
  type ChatEvent,
  type Choice,
  type Confirmation,
  type Notice,
  type TitleCard,
  type ToolCall,
  isPresent,
  toChatEvent,
} from '@/lib/events'
import type { RawEvent } from '@/lib/sse'

export const REPLY_STATES = { running: 'running', done: 'done', failed: 'failed' } as const

type ReplyState = (typeof REPLY_STATES)[keyof typeof REPLY_STATES]

export type Reply = {
  state: ReplyState
  chunks: string[]
  tools: ToolCall[]
  confirmations: Confirmation[]
  choices: Choice[]
  notices: Notice[]
  titles: TitleCard[]
  failure: string | null
  /** Why the turn broke on sparrow's side, as the sandbox reports it. */
  cause: string | null
  /** The case message this answers, when it was sent from the case's list. */
  expected: CaseTurn | null
}

type ApplyEventProps = { reply: Reply; event: ChatEvent }

/** `reply` with one more of its stream's events applied. */
const applyEvent = ({ reply, event }: ApplyEventProps): Reply => {
  switch (event.name) {
    case CHAT_EVENTS.tool:
      return { ...reply, tools: [...reply.tools, event.tool] }
    case CHAT_EVENTS.text:
      return { ...reply, chunks: [...reply.chunks, event.text] }
    case CHAT_EVENTS.confirm:
      return { ...reply, confirmations: [...reply.confirmations, event.confirmation] }
    case CHAT_EVENTS.choices:
      return { ...reply, choices: event.choices }
    case CHAT_EVENTS.titles:
      return { ...reply, titles: [...reply.titles, ...event.titles] }
    case CHAT_EVENTS.notice:
      return { ...reply, notices: [...reply.notices, event.notice] }
    case CHAT_EVENTS.failure:
      return { ...reply, cause: event.detail }
    case CHAT_EVENTS.done:
      return { ...reply, state: REPLY_STATES.done }
    case CHAT_EVENTS.error:
      return { ...reply, state: REPLY_STATES.failed, failure: CHAT_COPY.broke(event.ref) }
    default: {
      const unknown: never = event
      return unknown
    }
  }
}

const readChatEvents = (events: RawEvent[]): ChatEvent[] =>
  events.map((event) => toChatEvent(event)).filter(isPresent)

type ToReplyProps = { entry: ReplyEntry }

/** The reply `entry` keeps, as its events and the page's own failure build it. */
export const toReply = ({ entry }: ToReplyProps): Reply => {
  const start: Reply = {
    state: REPLY_STATES.running,
    chunks: [],
    tools: [],
    confirmations: [],
    choices: [],
    notices: [],
    titles: [],
    failure: null,
    cause: null,
    expected: entry.expected,
  }
  const reply = readChatEvents(entry.events).reduce(
    (built, event) => applyEvent({ reply: built, event }),
    start,
  )
  if (entry.failure === null) return reply
  return { ...reply, state: REPLY_STATES.failed, failure: entry.failure }
}

/** The notices among `events`, as a decision keeps them. */
export const noticesOf = (events: RawEvent[]): Notice[] =>
  readChatEvents(events).flatMap((event) =>
    event.name === CHAT_EVENTS.notice ? [event.notice] : [],
  )
