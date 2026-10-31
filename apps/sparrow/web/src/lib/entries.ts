/**
 * What the conversation on the page is made of, and the check that a saved
 * one read back from the browser's storage still has that shape. Storage is
 * untrusted (another version of the page, a hand edit), so what fails the
 * check is dropped, never trusted.
 */
import { type CaseTurn, isStrings } from '@/lib/api'
import {
  type Choice,
  type Confirmation,
  type Notice,
  type TitleCard,
  type ToolCall,
  isNoticeKind,
  isRecord,
  isWebAddress,
} from '@/lib/events'

export const ENTRY_KINDS = { said: 'said', reply: 'reply', decision: 'decision' } as const
export const REPLY_STATES = { running: 'running', done: 'done', failed: 'failed' } as const

type ReplyState = (typeof REPLY_STATES)[keyof typeof REPLY_STATES]

type Said = { kind: typeof ENTRY_KINDS.said; id: number; text: string }

export type Reply = {
  kind: typeof ENTRY_KINDS.reply
  id: number
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

type DecisionEntry = {
  kind: typeof ENTRY_KINDS.decision
  id: number
  text: string
  notices: Notice[]
}

export type Entry = Said | Reply | DecisionEntry

/** A conversation as the page keeps it: whose it is, its entries, and the spent buttons. */
export type SavedChat = { owner: string; entries: Entry[]; settled: number[] }

const INTERRUPTED = 'The page was reloaded before this reply arrived.'

const isNullableString = (value: unknown): value is string | null =>
  value === null || typeof value === 'string'

const isListOf =
  <T>(guard: (value: unknown) => value is T) =>
  (value: unknown): value is T[] =>
    Array.isArray(value) && value.every(guard)

const isReplyState = (value: unknown): value is ReplyState =>
  Object.values(REPLY_STATES).some((state) => state === value)

const isToolCall = (value: unknown): value is ToolCall =>
  isRecord(value) &&
  typeof value.name === 'string' &&
  isRecord(value.input) &&
  typeof value.ok === 'boolean' &&
  typeof value.result === 'string'

const isConfirmation = (value: unknown): value is Confirmation =>
  isRecord(value) &&
  typeof value.pendingId === 'number' &&
  typeof value.summary === 'string' &&
  typeof value.action === 'string'

const isChoice = (value: unknown): value is Choice =>
  isRecord(value) &&
  typeof value.label === 'string' &&
  typeof value.value === 'string' &&
  (value.year === null || typeof value.year === 'number') &&
  typeof value.display === 'string' &&
  typeof value.detail === 'string'

const isNotice = (value: unknown): value is Notice =>
  isRecord(value) &&
  isNoticeKind(value.kind) &&
  typeof value.text === 'string' &&
  (value.pendingId === null || typeof value.pendingId === 'number') &&
  isNullableString(value.to)

const isTitleCard = (value: unknown): value is TitleCard =>
  isRecord(value) &&
  typeof value.key === 'string' &&
  typeof value.title === 'string' &&
  (value.year === null || typeof value.year === 'number') &&
  (value.logoUrl === null || isWebAddress(value.logoUrl)) &&
  Array.isArray(value.links) &&
  value.links.every(
    (link) => isRecord(link) && typeof link.label === 'string' && isWebAddress(link.url),
  )

const isCaseTurn = (value: unknown): value is CaseTurn =>
  isRecord(value) &&
  typeof value.user === 'string' &&
  isStrings(value.expectTools) &&
  isStrings(value.forbidTools) &&
  isNullableString(value.replyMatches) &&
  isNullableString(value.replyNotMatches)

const isEntry = (value: unknown): value is Entry => {
  if (!isRecord(value) || typeof value.id !== 'number') return false
  switch (value.kind) {
    case ENTRY_KINDS.said:
      return typeof value.text === 'string'
    case ENTRY_KINDS.decision:
      return typeof value.text === 'string' && isListOf(isNotice)(value.notices)
    case ENTRY_KINDS.reply:
      return (
        isReplyState(value.state) &&
        isStrings(value.chunks) &&
        isListOf(isToolCall)(value.tools) &&
        isListOf(isConfirmation)(value.confirmations) &&
        isListOf(isChoice)(value.choices) &&
        isListOf(isNotice)(value.notices) &&
        isListOf(isTitleCard)(value.titles) &&
        isNullableString(value.failure) &&
        isNullableString(value.cause) &&
        (value.expected === null || isCaseTurn(value.expected))
      )
    default:
      return false
  }
}

const isNumbers = (value: unknown): value is number[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'number')

/** A reply that was still arriving when the page went away; its stream is gone with it. */
const settle = (entry: Entry): Entry =>
  entry.kind === ENTRY_KINDS.reply && entry.state === REPLY_STATES.running
    ? { ...entry, state: REPLY_STATES.failed, failure: INTERRUPTED }
    : entry

/**
 * The saved conversation in `value`, or null when there is none or it doesn't check out.
 * Entry ids are their indexes, as the store appends them.
 */
export const toSavedChat = (value: unknown): SavedChat | null => {
  if (!isRecord(value) || typeof value.owner !== 'string' || !isNumbers(value.settled)) return null
  const { entries } = value
  if (!isListOf(isEntry)(entries) || !entries.every((entry, index) => entry.id === index)) {
    return null
  }
  return { owner: value.owner, entries: entries.map(settle), settled: value.settled }
}
