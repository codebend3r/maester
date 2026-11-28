import { deepEqual, equal } from 'node:assert/strict'
import {
  CLAIM_STATUSES,
  HEADERS,
  HTTP_METHODS,
  LINK_TYPE,
  NO_STORE,
  PROJECT_PATHS,
  handleClaim,
} from '@/claim'

const PROJECT = { url: 'https://project.test', serviceKey: 'service-key' }
const DEVICE_CODE = 'a'.repeat(64)
const EMAIL = 'friend@maester.test'

const TOKENS = {
  access_token: 'access',
  refresh_token: 'refresh',
  expires_in: 3600,
  user: { id: 'user-1' },
}

type Call = { path: string; body: unknown; key: string | null }

type ClaimRequestProps = { method?: string; body?: string | null }

const claimRequest = ({
  method = HTTP_METHODS.post,
  body = JSON.stringify({ deviceCode: DEVICE_CODE }),
}: ClaimRequestProps) => new Request('https://functions.test/device-sign-in', { method, body })

type RunProps = { request: Request; answers: Partial<Record<string, Response>> }

const run = async ({ request, answers }: RunProps) => {
  const calls: Call[] = []
  const response = await handleClaim({
    request,
    project: PROJECT,
    fetch: async (url, init) => {
      const path = url.replace(PROJECT.url, '')
      const headers = new Headers(init.headers)
      calls.push({
        path,
        body: typeof init.body === 'string' ? JSON.parse(init.body) : null,
        key: headers.get(HEADERS.apiKey),
      })
      return answers[path] ?? new Response(null, { status: 500 })
    },
  })
  const text = await response.text()
  return { status: response.status, body: text === '' ? null : JSON.parse(text), calls, response }
}

type ClaimedProps = {
  status: (typeof CLAIM_STATUSES)[keyof typeof CLAIM_STATUSES]
  email?: string | null
}

const claimed = ({ status, email = null }: ClaimedProps) => Response.json([{ status, email }])

Deno.test('refuses anything but a POST', async () => {
  const { status, calls } = await run({
    request: claimRequest({ method: HTTP_METHODS.get, body: null }),
    answers: {},
  })
  equal(status, 405)
  deepEqual(calls, [])
})

Deno.test('refuses a body with no well-formed device code', async () => {
  const { status, calls } = await run({
    request: claimRequest({ body: JSON.stringify({ deviceCode: 'short' }) }),
    answers: {},
  })
  equal(status, 400)
  deepEqual(calls, [])
})

Deno.test('says pending while nobody has approved, and makes no session', async () => {
  const { status, body, calls } = await run({
    request: claimRequest({}),
    answers: { [PROJECT_PATHS.claim]: claimed({ status: CLAIM_STATUSES.pending }) },
  })
  equal(status, 200)
  deepEqual(body, { status: CLAIM_STATUSES.pending })
  deepEqual(calls, [
    { path: PROJECT_PATHS.claim, body: { device_code: DEVICE_CODE }, key: PROJECT.serviceKey },
  ])
})

Deno.test('says gone for a code that is unknown or past its time', async () => {
  const { body } = await run({
    request: claimRequest({}),
    answers: { [PROJECT_PATHS.claim]: claimed({ status: CLAIM_STATUSES.gone }) },
  })
  deepEqual(body, { status: CLAIM_STATUSES.gone })
})

Deno.test("hands an approved TV a session of the approver's, never stored", async () => {
  const { status, body, calls, response } = await run({
    request: claimRequest({}),
    answers: {
      [PROJECT_PATHS.claim]: claimed({ status: CLAIM_STATUSES.approved, email: EMAIL }),
      [PROJECT_PATHS.generateLink]: Response.json({ hashed_token: 'hashed' }),
      [PROJECT_PATHS.verify]: Response.json(TOKENS),
    },
  })
  equal(status, 200)
  deepEqual(body, {
    status: CLAIM_STATUSES.approved,
    session: {
      accessToken: 'access',
      refreshToken: 'refresh',
      expiresIn: 3600,
      userId: 'user-1',
      email: EMAIL,
    },
  })
  equal(response.headers.get(HEADERS.cacheControl), NO_STORE)
  deepEqual(calls.slice(1), [
    {
      path: PROJECT_PATHS.generateLink,
      body: { type: LINK_TYPE, email: EMAIL },
      key: PROJECT.serviceKey,
    },
    {
      path: PROJECT_PATHS.verify,
      body: { type: LINK_TYPE, token_hash: 'hashed' },
      key: PROJECT.serviceKey,
    },
  ])
})

Deno.test('answers 502 when the database does not answer', async () => {
  const { status } = await run({ request: claimRequest({}), answers: {} })
  equal(status, 502)
})

Deno.test('answers 502 when no session could be made', async () => {
  const { status } = await run({
    request: claimRequest({}),
    answers: {
      [PROJECT_PATHS.claim]: claimed({ status: CLAIM_STATUSES.approved, email: EMAIL }),
      [PROJECT_PATHS.generateLink]: Response.json({ hashed_token: 'hashed' }),
    },
  })
  equal(status, 502)
})
