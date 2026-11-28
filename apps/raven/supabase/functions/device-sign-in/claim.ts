export const HTTP_METHODS = { get: 'GET', post: 'POST' } as const

const HTTP_STATUSES = { ok: 200, badRequest: 400, methodNotAllowed: 405, badGateway: 502 } as const

/** How a TV's ask ends: nobody has approved yet, the account's session, or a code to start over from. */
export const CLAIM_STATUSES = { pending: 'pending', approved: 'approved', gone: 'gone' } as const
type ClaimStatus = (typeof CLAIM_STATUSES)[keyof typeof CLAIM_STATUSES]

export const HEADERS = {
  apiKey: 'apikey',
  authorization: 'authorization',
  contentType: 'content-type',
  cacheControl: 'cache-control',
} as const

const JSON_TYPE = 'application/json'

// A session is never kept by anything between the function and the TV.
export const NO_STORE = 'no-store'

/** The project's own routes the function calls with its service key. */
export const PROJECT_PATHS = {
  claim: '/rest/v1/rpc/claim_device_sign_in',
  generateLink: '/auth/v1/admin/generate_link',
  verify: '/auth/v1/verify',
} as const

// Supabase Auth's name for a one-time sign-in link, which is how it makes a session for an address.
export const LINK_TYPE = 'magiclink'

// The TV's secret as `start_device_sign_in` makes it: 32 random bytes in hex.
const DEVICE_CODE = /^[0-9a-f]{64}$/

type Json = Record<string, unknown>

const isRecord = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** What a TV sends with its ask. */
type ClaimBody = { deviceCode: string }

const hasDeviceCode = (value: unknown): value is ClaimBody =>
  isRecord(value) && typeof value.deviceCode === 'string' && DEVICE_CODE.test(value.deviceCode)

const isClaimStatus = (value: unknown): value is ClaimStatus =>
  Object.values(CLAIM_STATUSES).some((status) => status === value)

type Claim = { status: ClaimStatus; email: string | null }

const isClaim = (value: unknown): value is Claim =>
  isRecord(value) &&
  isClaimStatus(value.status) &&
  (value.email === null || typeof value.email === 'string')

/** The part of Auth's magic link the function verifies. */
type MagicLink = { hashed_token: string }

const hasHashedToken = (value: unknown): value is MagicLink =>
  isRecord(value) && typeof value.hashed_token === 'string' && value.hashed_token.length > 0

type TokenAnswer = {
  access_token: string
  refresh_token: string
  expires_in: number
  user: { id: string }
}

const isTokenAnswer = (value: unknown): value is TokenAnswer =>
  isRecord(value) &&
  typeof value.access_token === 'string' &&
  typeof value.refresh_token === 'string' &&
  typeof value.expires_in === 'number' &&
  isRecord(value.user) &&
  typeof value.user.id === 'string'

/** The session an approved TV is handed, as core's `isDeviceSession` reads it. */
type DeviceSession = {
  accessToken: string
  refreshToken: string
  expiresIn: number
  userId: string
  email: string
}

/** What the TV is answered, as core's `isDeviceClaim` reads it. */
type ClaimAnswer =
  | { status: typeof CLAIM_STATUSES.pending | typeof CLAIM_STATUSES.gone }
  | { status: typeof CLAIM_STATUSES.approved; session: DeviceSession }

/**
 * The Supabase project the function runs in: its address, with no slash at its end, and the
 * service key only it holds.
 */
type Project = { url: string; serviceKey: string }

type FetchLike = (url: string, init: RequestInit) => Promise<Response>

type AskProjectProps = { project: Project; fetch: FetchLike; path: string; body: Json }

/** One call to the project with the service key; null for any answer that is not JSON and 2xx. */
const askProject = async ({ project, fetch, path, body }: AskProjectProps): Promise<unknown> => {
  try {
    const response = await fetch(`${project.url}${path}`, {
      method: HTTP_METHODS.post,
      headers: {
        [HEADERS.apiKey]: project.serviceKey,
        [HEADERS.authorization]: `Bearer ${project.serviceKey}`,
        [HEADERS.contentType]: JSON_TYPE,
      },
      body: JSON.stringify(body),
    })
    if (!response.ok) return null
    return await response.json()
  } catch {
    return null
  }
}

type ReadBodyProps = { request: Request }

const readBody = async ({ request }: ReadBodyProps): Promise<unknown> => {
  try {
    return await request.json()
  } catch {
    return null
  }
}

type AnswerProps = { status: number; body: ClaimAnswer }

const answer = ({ status, body }: AnswerProps) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { [HEADERS.contentType]: JSON_TYPE, [HEADERS.cacheControl]: NO_STORE },
  })

type SessionForProps = { project: Project; fetch: FetchLike; email: string }

/*
 * A new session for the approver's address: Supabase Auth makes a one-time sign-in link for it,
 * which is never mailed, and the function spends the link's token itself. The TV gets tokens of
 * its own, so signing it out later signs out nothing else.
 */
const sessionFor = async ({
  project,
  fetch,
  email,
}: SessionForProps): Promise<DeviceSession | null> => {
  const link = await askProject({
    project,
    fetch,
    path: PROJECT_PATHS.generateLink,
    body: { type: LINK_TYPE, email },
  })
  if (!hasHashedToken(link)) return null
  const tokens = await askProject({
    project,
    fetch,
    path: PROJECT_PATHS.verify,
    body: { type: LINK_TYPE, token_hash: link.hashed_token },
  })
  if (!isTokenAnswer(tokens)) return null
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresIn: tokens.expires_in,
    userId: tokens.user.id,
    email,
  }
}

type HandleClaimProps = { request: Request; project: Project; fetch: FetchLike }

/**
 * A TV asking whether the code it shows has been approved, with the secret only it holds. The
 * database answers and spends the sign-in in one call (`claim_device_sign_in`); once approved,
 * the TV is handed a session of the approver's. Nothing here is logged: the body is a secret on
 * the way in and a session on the way out.
 */
export const handleClaim = async ({ request, project, fetch }: HandleClaimProps) => {
  if (request.method !== HTTP_METHODS.post)
    return new Response(null, { status: HTTP_STATUSES.methodNotAllowed })
  const body = await readBody({ request })
  if (!hasDeviceCode(body)) return new Response(null, { status: HTTP_STATUSES.badRequest })
  const rows = await askProject({
    project,
    fetch,
    path: PROJECT_PATHS.claim,
    body: { device_code: body.deviceCode },
  })
  const claim = Array.isArray(rows) ? rows.find(isClaim) : undefined
  if (claim === undefined) return new Response(null, { status: HTTP_STATUSES.badGateway })
  if (claim.status !== CLAIM_STATUSES.approved) {
    return answer({ status: HTTP_STATUSES.ok, body: { status: claim.status } })
  }
  if (claim.email === null)
    return answer({ status: HTTP_STATUSES.ok, body: { status: CLAIM_STATUSES.gone } })
  const session = await sessionFor({ project, fetch, email: claim.email })
  // The sign-in is spent either way, so a TV that hears this starts a new one.
  if (session === null) return new Response(null, { status: HTTP_STATUSES.badGateway })
  return answer({ status: HTTP_STATUSES.ok, body: { status: CLAIM_STATUSES.approved, session } })
}
