/**
 * What a chat turn's stream says, checked at the boundary. The server's names
 * (`luwin/web/chat.py`) are snake case; past the guards everything is the
 * shapes below.
 */
import type { RawEvent } from '@/lib/sse'

export const CHAT_EVENTS = {
  tool: 'tool',
  text: 'text',
  confirm: 'confirm',
  choices: 'choices',
  titles: 'titles',
  notice: 'notice',
  failure: 'failure',
  done: 'done',
  error: 'error',
} as const

export const NOTICE_KINDS = {
  adminPost: 'admin_post',
  approval: 'approval',
  announcement: 'announcement',
  directMessage: 'direct_message',
} as const

export type NoticeKind = (typeof NOTICE_KINDS)[keyof typeof NOTICE_KINDS]

export type ToolCall = { name: string; input: Record<string, unknown>; ok: boolean; result: string }
export type Confirmation = { pendingId: number; summary: string; action: string }
export type Choice = {
  label: string
  value: string
  year: number | null
  display: string
  detail: string
}
type TitleLink = { label: string; url: string }
/** A title a tool found, shown beside the reply: its logo, and a link per copy. */
export type TitleCard = {
  key: string
  title: string
  year: number | null
  logoUrl: string | null
  links: TitleLink[]
}
export type Notice = { kind: NoticeKind; text: string; pendingId: number | null; to: string | null }

export type ChatEvent =
  | { name: typeof CHAT_EVENTS.tool; tool: ToolCall }
  | { name: typeof CHAT_EVENTS.text; text: string }
  | { name: typeof CHAT_EVENTS.confirm; confirmation: Confirmation }
  | { name: typeof CHAT_EVENTS.choices; choices: Choice[] }
  | { name: typeof CHAT_EVENTS.titles; titles: TitleCard[] }
  | { name: typeof CHAT_EVENTS.notice; notice: Notice }
  | { name: typeof CHAT_EVENTS.failure; detail: string }
  | { name: typeof CHAT_EVENTS.done }
  | { name: typeof CHAT_EVENTS.error; ref: string }

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value != null && !Array.isArray(value)

export const isNoticeKind = (value: unknown): value is NoticeKind =>
  Object.values(NOTICE_KINDS).some((kind) => kind === value)

const toTool = (data: Record<string, unknown>): ToolCall | null =>
  typeof data.name === 'string' &&
  isRecord(data.input) &&
  typeof data.ok === 'boolean' &&
  typeof data.result === 'string'
    ? { name: data.name, input: data.input, ok: data.ok, result: data.result }
    : null

const toConfirmation = (data: Record<string, unknown>): Confirmation | null =>
  typeof data.pending_id === 'number' &&
  typeof data.summary === 'string' &&
  typeof data.action === 'string'
    ? { pendingId: data.pending_id, summary: data.summary, action: data.action }
    : null

const toChoice = (value: unknown): Choice | null => {
  if (
    !isRecord(value) ||
    typeof value.label !== 'string' ||
    typeof value.value !== 'string' ||
    typeof value.display !== 'string'
  )
    return null
  return {
    label: value.label,
    value: value.value,
    year: typeof value.year === 'number' ? value.year : null,
    display: value.display,
    detail: typeof value.detail === 'string' ? value.detail : '',
  }
}

/** Whether `value` is an address the page may load or open: http or https only. */
export const isWebAddress = (value: unknown): value is string =>
  typeof value === 'string' && /^https?:\/\//.test(value)

const toTitleLink = (value: unknown): TitleLink | null =>
  isRecord(value) && typeof value.label === 'string' && isWebAddress(value.url)
    ? { label: value.label, url: value.url }
    : null

const toTitleCard = (value: unknown): TitleCard | null => {
  if (
    !isRecord(value) ||
    typeof value.key !== 'string' ||
    typeof value.title !== 'string' ||
    !Array.isArray(value.links)
  )
    return null
  return {
    key: value.key,
    title: value.title,
    year: typeof value.year === 'number' ? value.year : null,
    logoUrl: isWebAddress(value.logo_url) ? value.logo_url : null,
    links: value.links.map(toTitleLink).filter(isPresent),
  }
}

/** A notice as the stream or the decide route sends it, or null when it isn't one. */
export const toNotice = (value: unknown): Notice | null => {
  if (!isRecord(value) || !isNoticeKind(value.kind) || typeof value.text !== 'string') return null
  return {
    kind: value.kind,
    text: value.text,
    pendingId: typeof value.pending_id === 'number' ? value.pending_id : null,
    to: typeof value.to === 'string' ? value.to : null,
  }
}

const parse = (data: string): unknown => {
  try {
    return JSON.parse(data)
  } catch {
    return null
  }
}

export const isPresent = <T>(value: T | null): value is T => value != null

/** One raw event as a `ChatEvent`, or null for anything this page doesn't know. */
export const toChatEvent = ({ name, data }: RawEvent): ChatEvent | null => {
  const body = parse(data)
  if (!isRecord(body)) return null
  switch (name) {
    case CHAT_EVENTS.tool: {
      const tool = toTool(body)
      return tool && { name, tool }
    }
    case CHAT_EVENTS.text:
      return typeof body.text === 'string' ? { name, text: body.text } : null
    case CHAT_EVENTS.confirm: {
      const confirmation = toConfirmation(body)
      return confirmation && { name, confirmation }
    }
    case CHAT_EVENTS.choices:
      return Array.isArray(body.choices)
        ? { name, choices: body.choices.map(toChoice).filter(isPresent) }
        : null
    case CHAT_EVENTS.titles:
      return Array.isArray(body.titles)
        ? { name, titles: body.titles.map(toTitleCard).filter(isPresent) }
        : null
    case CHAT_EVENTS.notice: {
      const notice = toNotice(body)
      return notice && { name, notice }
    }
    case CHAT_EVENTS.failure:
      return typeof body.detail === 'string' ? { name, detail: body.detail } : null
    case CHAT_EVENTS.done:
      return { name }
    case CHAT_EVENTS.error:
      return typeof body.ref === 'string' ? { name, ref: body.ref } : null
    default:
      return null
  }
}
