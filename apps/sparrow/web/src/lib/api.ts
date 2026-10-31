/**
 * sparrow's own API, on the same origin in every setup: in development Vite
 * proxies to it, whether the real server or the sandbox is listening. Writes
 * are JSON, which the server requires.
 */
import {
  type ChatEvent,
  type Notice,
  isPresent,
  isRecord,
  toChatEvent,
  toNotice,
} from '@/lib/events'
import { readEvents } from '@/lib/sse'

export const ROUTES = {
  me: '/api/me',
  sandbox: '/api/sandbox',
  sandboxCase: '/api/sandbox/case',
  sandboxTier: '/api/sandbox/tier',
  chat: '/api/chat',
  pick: '/api/chat/pick',
  decide: '/api/chat/decide',
  forget: '/api/chat/forget',
  usage: '/api/chat/usage',
} as const

export type ChatRoute = typeof ROUTES.chat | typeof ROUTES.pick

export const TIERS = {
  unlinked: 'unlinked',
  friend: 'friend',
  trusted: 'trusted',
  admin: 'admin',
} as const

export type Tier = (typeof TIERS)[keyof typeof TIERS]

/** The tiers the sandbox can put its user at; an unlinked user can't chat at all. */
export const SANDBOX_TIERS = [TIERS.friend, TIERS.trusted, TIERS.admin] as const

export type SandboxTier = (typeof SANDBOX_TIERS)[number]

const isTier = (value: unknown): value is Tier =>
  Object.values(TIERS).some((tier) => tier === value)

export const isSandboxTier = (value: unknown): value is SandboxTier =>
  SANDBOX_TIERS.some((tier) => tier === value)

export const SIGN_IN_STATES = { signedIn: 'signed_in', signedOut: 'signed_out' } as const

export type Me =
  | { state: typeof SIGN_IN_STATES.signedIn; id: string; name: string; tier: Tier }
  | { state: typeof SIGN_IN_STATES.signedOut; signIn: string }

/** One message of an eval case, with what the case expects of sparrow's answer. */
export type CaseTurn = {
  user: string
  expectTools: string[]
  forbidTools: string[]
  replyMatches: string | null
  replyNotMatches: string | null
}

type SandboxCase = { id: string; name: string }

export type SandboxState = {
  model: string
  /** The real raven the sandbox searches, or null for the case's fake. */
  raven: string | null
  /** The open world's id, which names its conversation. */
  world: string
  case: SandboxCase & { turns: CaseTurn[] }
  cases: SandboxCase[]
}

export type Decision = { text: string; isSettled: boolean; notices: Notice[] }

/** Today's tokens against the daily budget, null where the server keeps no budget. */
type Budget = { used: number; total: number }

/** The model answering, and how much of today's budget is left. */
export type Usage = { model: string; budget: Budget | null }

class ApiError extends Error {
  constructor(readonly status: number) {
    super(`sparrow answered ${status}`)
  }
}

const HTTP_METHODS = { post: 'POST' } as const
const HEADERS = { contentType: 'content-type' } as const
const CONTENT_TYPES = { json: 'application/json' } as const

type PostProps = { url: string; body: unknown }

const post = async ({ url, body }: PostProps): Promise<Response> => {
  const response = await fetch(url, {
    method: HTTP_METHODS.post,
    headers: { [HEADERS.contentType]: CONTENT_TYPES.json },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new ApiError(response.status)
  return response
}

const readJson = async (response: Response): Promise<unknown> => response.json().catch(() => null)

export const isStrings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string')

const stringOrNull = (value: unknown): string | null => (typeof value === 'string' ? value : null)

const toCaseTurn = (value: unknown): CaseTurn | null =>
  isRecord(value) &&
  typeof value.user === 'string' &&
  isStrings(value.expect_tools) &&
  isStrings(value.forbid_tools)
    ? {
        user: value.user,
        expectTools: value.expect_tools,
        forbidTools: value.forbid_tools,
        replyMatches: stringOrNull(value.reply_matches),
        replyNotMatches: stringOrNull(value.reply_not_matches),
      }
    : null

const toSandboxCase = (value: unknown): SandboxCase | null =>
  isRecord(value) && typeof value.id === 'string' && typeof value.name === 'string'
    ? { id: value.id, name: value.name }
    : null

const toSandboxState = (value: unknown): SandboxState => {
  const current = isRecord(value) ? value.case : null
  const opened = toSandboxCase(current)
  if (
    !isRecord(value) ||
    typeof value.model !== 'string' ||
    typeof value.world !== 'string' ||
    !isRecord(current) ||
    !opened
  ) {
    throw new ApiError(502)
  }
  const turns = Array.isArray(current.turns) ? current.turns.map(toCaseTurn) : []
  const cases = Array.isArray(value.cases) ? value.cases.map(toSandboxCase) : []
  return {
    model: value.model,
    raven: stringOrNull(value.raven),
    world: value.world,
    case: { ...opened, turns: turns.filter(isPresent) },
    cases: cases.filter(isPresent),
  }
}

/** Who is signed in, or where to sign in when nobody is. */
export const fetchMe = async (): Promise<Me> => {
  const response = await fetch(ROUTES.me)
  const body = await readJson(response)
  if (response.status === 401 && isRecord(body) && typeof body.sign_in === 'string') {
    return { state: SIGN_IN_STATES.signedOut, signIn: body.sign_in }
  }
  const user = isRecord(body) ? body.user : null
  if (
    !response.ok ||
    !isRecord(body) ||
    !isRecord(user) ||
    typeof user.id !== 'string' ||
    !isTier(body.tier)
  ) {
    throw new ApiError(response.status)
  }
  const name = typeof user.display_name === 'string' ? user.display_name : ''
  return { state: SIGN_IN_STATES.signedIn, id: user.id, name, tier: body.tier }
}

/** The sandbox's world, or null when the real server is listening instead. */
export const fetchSandbox = async (): Promise<SandboxState | null> => {
  const response = await fetch(ROUTES.sandbox)
  if (response.status === 404) return null
  if (!response.ok) throw new ApiError(response.status)
  return toSandboxState(await readJson(response))
}

type OpenCaseProps = { id: string }

export const openCase = async ({ id }: OpenCaseProps): Promise<SandboxState> =>
  toSandboxState(await readJson(await post({ url: ROUTES.sandboxCase, body: { case: id } })))

type SetSandboxTierProps = { tier: SandboxTier }

export const setSandboxTier = async ({ tier }: SetSandboxTierProps): Promise<void> => {
  await post({ url: ROUTES.sandboxTier, body: { tier } })
}

type StreamTurnProps = {
  route: ChatRoute
  body: Record<string, unknown>
  onEvent: (event: ChatEvent) => void
}

/** Runs one turn, handing each event to `onEvent` as the stream delivers it. */
export const streamTurn = async ({ route, body, onEvent }: StreamTurnProps): Promise<void> => {
  const response = await post({ url: route, body })
  if (!response.body) throw new ApiError(response.status)
  await readEvents({
    body: response.body,
    onEvent: (raw) => {
      const event = toChatEvent(raw)
      if (event) onEvent(event)
    },
  })
}

type DecideProps = {
  pendingId: number
  approve: boolean
}

export const decide = async ({ pendingId, approve }: DecideProps): Promise<Decision> => {
  const body = await readJson(
    await post({ url: ROUTES.decide, body: { pending_id: pendingId, approve } }),
  )
  if (!isRecord(body) || typeof body.text !== 'string' || typeof body.settled !== 'boolean') {
    throw new ApiError(502)
  }
  const notices = Array.isArray(body.notices) ? body.notices.map(toNotice) : []
  return { text: body.text, isSettled: body.settled, notices: notices.filter(isPresent) }
}

const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0

/** The model, and the signed-in user's tokens today against the daily budget. */
export const fetchUsage = async (): Promise<Usage> => {
  const response = await fetch(ROUTES.usage)
  const body = await readJson(response)
  if (!response.ok || !isRecord(body) || typeof body.model !== 'string') {
    throw new ApiError(response.status)
  }
  const budget =
    isCount(body.tokens_used) && isCount(body.token_budget) && body.token_budget > 0
      ? { used: body.tokens_used, total: body.token_budget }
      : null
  return { model: body.model, budget }
}

export const forget = async (): Promise<void> => {
  await post({ url: ROUTES.forget, body: {} })
}
