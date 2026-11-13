/**
 * What the conversation on the page is made of, and the check that a saved
 * one read back from the browser's storage still has that shape. A reply and
 * a decision keep the server's events as they came, so reading one back goes
 * through the stream's own guards (`toChatEvent`) when it renders. Storage is
 * untrusted (another version of the page, a hand edit), so what fails the
 * check is dropped, never trusted.
 */
import { type CaseTurn, isStrings } from '@/lib/api'
import { CHAT_COPY } from '@/lib/copy'
import { isRecord } from '@shared/http'
import { CHAT_EVENTS } from '@/lib/events'
import type { RawEvent } from '@/lib/sse'

export const ENTRY_KINDS = { said: 'said', reply: 'reply', decision: 'decision' } as const

/**
 * The saved shape's version. A save from before replies kept their events
 * (version 0) is dropped on load: the page starts a fresh conversation.
 */
export const SAVED_CHAT_VERSION = 1

type Said = { kind: typeof ENTRY_KINDS.said; id: number; text: string }

/** A reply as kept: its stream's events, and why it failed when the page saw it fail. */
export type ReplyEntry = {
  kind: typeof ENTRY_KINDS.reply
  id: number
  events: RawEvent[]
  /** A failure the page saw itself: sparrow unreachable, the stream cut off, a reload. */
  failure: string | null
  /** The case message this answers, when it was sent from the case's list. */
  expected: CaseTurn | null
}

/** A button press's answer, with the notice events it sent. */
type DecisionEntry = {
  kind: typeof ENTRY_KINDS.decision
  id: number
  text: string
  events: RawEvent[]
}

export type Entry = Said | ReplyEntry | DecisionEntry

export type EntryKind = Entry['kind']

/** A conversation as the page keeps it: whose it is, its entries, and the spent buttons. */
export type SavedChat = { owner: string; entries: Entry[]; settled: number[] }

const TERMINAL_EVENTS: ReadonlySet<string> = new Set([CHAT_EVENTS.done, CHAT_EVENTS.error])

/** Whether a reply's stream said it was over, with `done` or `error`. */
export const isFinished = (events: RawEvent[]): boolean =>
  events.some((event) => TERMINAL_EVENTS.has(event.name))

const isNullableString = (value: unknown): value is string | null =>
  value === null || typeof value === 'string'

const isRawEvent = (value: unknown): value is RawEvent =>
  isRecord(value) && typeof value.name === 'string' && typeof value.data === 'string'

const isRawEvents = (value: unknown): value is RawEvent[] =>
  Array.isArray(value) && value.every(isRawEvent)

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
      return typeof value.text === 'string' && isRawEvents(value.events)
    case ENTRY_KINDS.reply:
      return (
        isRawEvents(value.events) &&
        isNullableString(value.failure) &&
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
  entry.kind === ENTRY_KINDS.reply && entry.failure === null && !isFinished(entry.events)
    ? { ...entry, failure: CHAT_COPY.interrupted }
    : entry

/**
 * The saved conversation in `value`, or null when there is none or it doesn't check out.
 * Entry ids are their indexes, as the store appends them.
 */
export const toSavedChat = (value: unknown): SavedChat | null => {
  if (!isRecord(value) || typeof value.owner !== 'string' || !isNumbers(value.settled)) return null
  const { entries } = value
  if (!Array.isArray(entries) || !entries.every(isEntry)) return null
  if (!entries.every((entry, index) => entry.id === index)) return null
  return { owner: value.owner, entries: entries.map(settle), settled: value.settled }
}

/** What an older save becomes: nothing, so the page starts fresh instead of misreading it. */
export const dropOlderSave = (): Partial<SavedChat> => ({})
