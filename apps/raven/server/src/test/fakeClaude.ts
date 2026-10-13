import { isRecord, isString } from '@raven/core'
import type { AiFetch } from '@/metadata/aiClient'

/** One reply Claude gives in a lookup, in turn: a tool call, a refusal, or words and no tool. */
export type FakeReply =
  | { kind: 'search'; type: 'movie' | 'show'; query: string; year: number | null }
  | { kind: 'episodes'; tmdbId: string; season: number }
  | { kind: 'choose'; tmdbId: string | null; confidence: 'high' | 'low'; reason: string }
  /** Any tool call, as written, for one raven must refuse to run. */
  | { kind: 'call'; name: string; input: Record<string, unknown> }
  | { kind: 'refuse' }
  | { kind: 'say'; text: string }

/** A request raven sent Claude. */
export type SeenRequest = {
  url: string
  apiKey: string | null
  /** The body as sent. */
  raw: string
  body: Record<string, unknown>
  /** The group its lookup is about, read from the facts its first message gives; null for any other request. */
  place: string | null
  /** How many replies Claude had given in its lookup before it: 0 for a lookup's first request. */
  turn: number
}

const json = ({
  body,
  status = 200,
  headers = {},
}: {
  body: unknown
  status?: number
  headers?: Record<string, string>
}): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })

const messagesOf = (body: Record<string, unknown>): unknown[] =>
  Array.isArray(body.messages) ? body.messages : []

/** The place a lookup is about, read back from the JSON its first message ends with. */
const placeOf = (body: Record<string, unknown>): string | null => {
  const [first] = messagesOf(body)
  const content = isRecord(first) && isString(first.content) ? first.content : ''
  const start = content.indexOf('{')
  if (start < 0) return null
  const facts: unknown = JSON.parse(content.slice(start))
  return isRecord(facts) && isString(facts.place) ? facts.place : null
}

const turnOf = (body: Record<string, unknown>): number =>
  messagesOf(body).filter((message) => isRecord(message) && message.role === 'assistant').length

const toolUse = ({
  turn,
  name,
  input,
}: {
  turn: number
  name: string
  input: Record<string, unknown>
}) => ({ type: 'tool_use', id: `toolu_${turn}`, name, input, caller: { type: 'direct' } })

/**
 * The stop reason and content Claude answers a reply with. Every answer but
 * a refusal opens with a thinking block, as adaptive thinking gives one,
 * which raven must send back exactly as it came.
 */
const answerFor = ({
  reply,
  turn,
}: {
  reply: FakeReply | undefined
  turn: number
}): { stop: string; content: unknown[] } => {
  const thinking = { type: 'thinking', thinking: '', signature: `signature-${turn}` }
  if (reply == null) {
    return { stop: 'end_turn', content: [thinking, { type: 'text', text: 'I could not decide.' }] }
  }
  switch (reply.kind) {
    case 'search':
      return {
        stop: 'tool_use',
        content: [
          thinking,
          toolUse({
            turn,
            name: 'search_tmdb',
            input: { type: reply.type, query: reply.query, year: reply.year },
          }),
        ],
      }
    case 'episodes':
      return {
        stop: 'tool_use',
        content: [
          thinking,
          toolUse({
            turn,
            name: 'list_episodes',
            input: { tmdbId: reply.tmdbId, season: reply.season },
          }),
        ],
      }
    case 'choose':
      return {
        stop: 'tool_use',
        content: [
          thinking,
          toolUse({
            turn,
            name: 'choose_match',
            input: { tmdbId: reply.tmdbId, confidence: reply.confidence, reason: reply.reason },
          }),
        ],
      }
    case 'call':
      return {
        stop: 'tool_use',
        content: [thinking, toolUse({ turn, name: reply.name, input: reply.input })],
      }
    case 'refuse':
      return { stop: 'refusal', content: [] }
    case 'say':
      return { stop: 'end_turn', content: [thinking, { type: 'text', text: reply.text }] }
    default: {
      const unreachable: never = reply
      return unreachable
    }
  }
}

/**
 * Claude in miniature for the AI lookup: each lookup, named by its group's
 * place, gets its replies in turn, then words and no choice. A `status`
 * other than 200 answers every request with that error, marked not to be
 * retried, so a test never waits out the SDK's backoff. `requests` records
 * what raven sent. `hold` keeps a group's requests waiting, recorded but not
 * answered, until the function it returns is called.
 */
export const fakeClaude = ({
  lookups,
}: {
  lookups: Readonly<Partial<Record<string, readonly FakeReply[]>>>
}) => {
  const state: { status: number; requests: SeenRequest[] } = { status: 200, requests: [] }
  const held = new Map<string, Promise<void>>()
  const hold = (place: string): (() => void) => {
    const gate = { open: () => {} }
    held.set(
      place,
      new Promise((resolve) => {
        gate.open = resolve
      }),
    )
    return () => {
      held.delete(place)
      gate.open()
    }
  }
  const fetch: AiFetch = async (input, init) => {
    const raw = typeof init?.body === 'string' ? init.body : ''
    const parsed: unknown = raw === '' ? null : JSON.parse(raw)
    const body = isRecord(parsed) ? parsed : {}
    const place = placeOf(body)
    const turn = turnOf(body)
    state.requests.push({
      url: String(input),
      apiKey: new Headers(init?.headers).get('x-api-key'),
      raw,
      body,
      place,
      turn,
    })
    await held.get(place ?? '')
    if (state.status !== 200) {
      return json({
        body: { type: 'error', error: { type: 'api_error', message: 'Away.' } },
        status: state.status,
        headers: { 'x-should-retry': 'false' },
      })
    }
    const answer = answerFor({ reply: (lookups[place ?? ''] ?? []).at(turn), turn })
    return json({
      body: {
        id: `msg_${state.requests.length}`,
        type: 'message',
        role: 'assistant',
        model: body.model,
        content: answer.content,
        stop_reason: answer.stop,
        stop_sequence: null,
        stop_details:
          answer.stop === 'refusal' ? { type: 'refusal', category: null, explanation: null } : null,
        container: null,
        diagnostics: null,
        usage: {
          input_tokens: 100,
          output_tokens: 20,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
      },
    })
  }
  return { fetch, state, hold }
}
