/*
 * sparrow's own API, on the same origin in every setup: in development Vite
 * proxies to it, whether the real server or the sandbox is listening. Writes
 * are JSON, which the server requires.
 */
import { AUTH_SCHEMES, CONTENT_TYPES, HEADERS, HTTP_METHODS, isRecord } from '@shared/http'
import { CHAT_EVENTS, isPresent, toChatEvent, toNotice } from '@/lib/events'
import { type RawEvent, readEvents } from '@/lib/sse'
import { useAuthSession } from '@/stores/authSession'

export const ROUTES = {
  authConfig: '/api/auth/config',
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

/** A picker's choice, sent back as the user's next message. */
type PickBody = { label: string; value: string; year: number | null }

/** A turn's route and the body it takes: a message, or a picker's choice. */
export type Turn =
  | { route: typeof ROUTES.chat; body: { text: string } }
  | { route: typeof ROUTES.pick; body: PickBody }

export const TIERS = {
  friend: 'friend',
  trusted: 'trusted',
  admin: 'admin',
} as const

export type Tier = (typeof TIERS)[keyof typeof TIERS]

/** The tiers the sandbox can put its user at: every one there is. */
export const SANDBOX_TIERS = [TIERS.friend, TIERS.trusted, TIERS.admin] as const

export type SandboxTier = (typeof SANDBOX_TIERS)[number]

const isTier = (value: unknown): value is Tier =>
  Object.values(TIERS).some((tier) => tier === value)

export const isSandboxTier = (value: unknown): value is SandboxTier =>
  SANDBOX_TIERS.some((tier) => tier === value)

export const SIGN_IN_STATES = {
  signedIn: 'signed_in',
  signedOut: 'signed_out',
  notApproved: 'not_approved',
  unavailable: 'unavailable',
} as const

export type Me =
  | { state: typeof SIGN_IN_STATES.signedIn; id: string; email: string; tier: Tier }
  | { state: typeof SIGN_IN_STATES.signedOut }
  | { state: typeof SIGN_IN_STATES.notApproved }
  | { state: typeof SIGN_IN_STATES.unavailable }

/** Why sparrow turned a request away, as its body's `reason` says. */
export const REFUSALS = {
  signedOut: 'signed_out',
  signInUnavailable: 'sign_in_unavailable',
  notApproved: 'not_approved',
} as const

/** The refusals that say who may not chat, each as the page's sign-in state. */
const REFUSED_STATES = {
  [REFUSALS.signedOut]: { state: SIGN_IN_STATES.signedOut },
  [REFUSALS.signInUnavailable]: { state: SIGN_IN_STATES.unavailable },
  [REFUSALS.notApproved]: { state: SIGN_IN_STATES.notApproved },
} as const satisfies Record<(typeof REFUSALS)[keyof typeof REFUSALS], Me>

type Refusal = keyof typeof REFUSED_STATES

const isRefusal = (value: unknown): value is Refusal =>
  Object.values(REFUSALS).some((reason) => reason === value)

/** raven's sign-in setup, as sparrow relays it from raven's `/api/auth/config`. */
export const AUTH_CONFIG_STATES = {
  off: 'off',
  unavailable: 'unavailable',
  ready: 'ready',
} as const

export type ReadyAuthConfig = {
  state: typeof AUTH_CONFIG_STATES.ready
  supabaseUrl: string
  publishableKey: string
}

export type AuthConfig =
  | { state: typeof AUTH_CONFIG_STATES.off }
  | { state: typeof AUTH_CONFIG_STATES.unavailable }
  | ReadyAuthConfig

const UNAVAILABLE_CONFIG = { state: AUTH_CONFIG_STATES.unavailable } as const

const toAuthConfig = (value: unknown): AuthConfig => {
  if (!isRecord(value)) return UNAVAILABLE_CONFIG
  if (value.state === AUTH_CONFIG_STATES.off) return { state: AUTH_CONFIG_STATES.off }
  if (
    value.state === AUTH_CONFIG_STATES.ready &&
    typeof value.supabaseUrl === 'string' &&
    typeof value.publishableKey === 'string'
  ) {
    return {
      state: AUTH_CONFIG_STATES.ready,
      supabaseUrl: value.supabaseUrl,
      publishableKey: value.publishableKey,
    }
  }
  return UNAVAILABLE_CONFIG
}

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

/** A press's answer, with the notices it sent as notice events, each already checked. */
export type Decision = { text: string; isSettled: boolean; events: RawEvent[] }

/** Today's tokens against the daily budget, null where the server keeps no budget. */
type Budget = { used: number; total: number }

/** The model answering, and how much of today's budget is left. */
export type Usage = { model: string; budget: Budget | null }

class ApiError extends Error {
  constructor(readonly status: number) {
    super(`sparrow answered ${status}`)
  }
}

/** The signed-in account's access token as every call's bearer; none for the sandbox, which asks for no sign-in. */
const authorized = (headers: Record<string, string> = {}): Record<string, string> => {
  const token = useAuthSession.getState().session?.accessToken ?? null
  if (token === null) return headers
  return { ...headers, [HEADERS.authorization]: `${AUTH_SCHEMES.bearer} ${token}` }
}

const get = (url: string): Promise<Response> => fetch(url, { headers: authorized() })

type PostProps = { url: string; body: unknown }

const post = async ({ url, body }: PostProps): Promise<Response> => {
  const response = await fetch(url, {
    method: HTTP_METHODS.post,
    headers: authorized({ [HEADERS.contentType]: CONTENT_TYPES.json }),
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

/** Who is signed in, or why nobody may chat: signed out, not approved in raven, or sign-in down. */
export const fetchMe = async (): Promise<Me> => {
  const response = await get(ROUTES.me)
  const body = await readJson(response)
  if (!response.ok && isRecord(body) && isRefusal(body.reason)) return REFUSED_STATES[body.reason]
  const user = isRecord(body) ? body.user : null
  if (
    !response.ok ||
    !isRecord(body) ||
    !isRecord(user) ||
    typeof user.id !== 'string' ||
    typeof user.email !== 'string' ||
    !isTier(body.tier)
  ) {
    throw new ApiError(response.status)
  }
  return { state: SIGN_IN_STATES.signedIn, id: user.id, email: user.email, tier: body.tier }
}

/** raven's sign-in setup; `unavailable` whenever it can't be read. */
export const fetchAuthConfig = async (): Promise<AuthConfig> => {
  const response = await fetch(ROUTES.authConfig).catch(() => null)
  if (response === null || !response.ok) return UNAVAILABLE_CONFIG
  return toAuthConfig(await readJson(response))
}

/** The sandbox's world, or null when the real server is listening instead. */
export const fetchSandbox = async (): Promise<SandboxState | null> => {
  const response = await get(ROUTES.sandbox)
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
  turn: Turn
  onEvent: (event: RawEvent) => void
}

/**
 * Runs one turn, handing each event this page can read to `onEvent` as the
 * stream delivers it, as it came, so the page can keep it.
 */
export const streamTurn = async ({ turn, onEvent }: StreamTurnProps): Promise<void> => {
  const response = await post({ url: turn.route, body: turn.body })
  if (!response.body) throw new ApiError(response.status)
  await readEvents({
    body: response.body,
    onEvent: (raw) => {
      if (toChatEvent(raw)) onEvent(raw)
    },
  })
}

const toNoticeEvent = (notice: unknown): RawEvent => ({
  name: CHAT_EVENTS.notice,
  data: JSON.stringify(notice),
})

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
  const notices = Array.isArray(body.notices) ? body.notices : []
  const events = notices.filter((notice) => toNotice(notice) !== null).map(toNoticeEvent)
  return { text: body.text, isSettled: body.settled, events }
}

const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0

/** The model, and the signed-in user's tokens today against the daily budget. */
export const fetchUsage = async (): Promise<Usage> => {
  const response = await get(ROUTES.usage)
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
