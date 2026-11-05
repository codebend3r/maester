import { lookup } from 'node:dns/promises'
import {
  REACHABILITY_CHECK_PATH,
  REACHABILITY_PARAMS,
  REACHABILITY_PROBLEMS,
  REMOTE_ACCESS_PARAMS,
  REMOTE_ACCESS_PATHS,
  REMOTE_ACCESS_STATES,
  type ReachabilityProblem,
  type ReachabilityReport,
  isEchoNonce,
  isPort,
  isPrivateAddress,
  isPublicHostname,
  isRecord,
  isString,
} from '@raven/core'

const HEADERS = { cacheControl: 'cache-control' } as const

const CACHE_POLICIES = { none: 'no-store' } as const

/** How long the check waits for raven to answer. */
const TARGET_TIMEOUT_MS = 8_000

/** What raven's echo answers a nonce a check in flight holds. */
const ECHO_ANSWERED = 204

/** The `name` `AbortSignal.timeout` aborts with. */
const TIMEOUT_ERROR = 'TimeoutError'

/** Node's codes for a connection that never answered. */
const TIMEOUT_CODES = new Set(['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT'])

/** Node's codes for a name that does not resolve. */
const DNS_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ENODATA'])

/** What a fetch's TLS failures have in their code: an untrusted, expired or misnamed certificate. */
const CERTIFICATE_CODE = /CERT|SSL|TLS|SELF_SIGNED|UNABLE_TO_VERIFY|UNABLE_TO_GET_ISSUER/

/** The one lookup the check makes; `dns.lookup` with `all` is one. */
type ResolveHost = (host: string) => Promise<string[]>

/** The one call the check makes to raven; `fetch` is one. */
type FetchTarget = (url: string, init: RequestInit) => Promise<Response>

type CheckReachabilityProps = {
  request: Request
  /** The address the call came from: the home network's, when raven asks. */
  callerAddress: string | null
  resolveHost: ResolveHost
  fetchTarget: FetchTarget
}

/** What the check answers: a report, or why it would not look. */
type Answer = ReachabilityReport | { error: string }

type AnswerProps = { body: Answer; status?: number }

const answer = ({ body, status = 200 }: AnswerProps): Response =>
  Response.json(body, { status, headers: { [HEADERS.cacheControl]: CACHE_POLICIES.none } })

/** The `code` of an error, or of the error it wraps, as undici's `fetch failed` wraps Node's. */
const codeOf = (error: unknown): string => {
  if (!isRecord(error)) return ''
  if (isString(error.code)) return error.code
  return isRecord(error.cause) ? codeOf(error.cause) : ''
}

/** Why the fetch of raven's echo failed, in the check's words. */
const problemOf = (error: unknown): ReachabilityProblem => {
  if (isRecord(error) && error.name === TIMEOUT_ERROR) return REACHABILITY_PROBLEMS.timeout
  const code = codeOf(error)
  if (TIMEOUT_CODES.has(code)) return REACHABILITY_PROBLEMS.timeout
  if (DNS_CODES.has(code)) return REACHABILITY_PROBLEMS.dns
  if (CERTIFICATE_CODE.test(code)) return REACHABILITY_PROBLEMS.certificate
  // Refused, reset, unreachable: nothing would take the connection.
  return REACHABILITY_PROBLEMS.refused
}

/**
 * Whether raven answers at `https://<host>:<port>` from the internet, which
 * raven can not test from inside its own network. Only raven, holding the
 * nonce of a check it started, answers its echo with a 204, so anything else
 * that answers is not it. The check takes a DNS name and a port and nothing
 * else, refuses a name that resolves to a private address (Netlify's own
 * network included), fetches one fixed path without following redirects, and
 * passes on no byte of what it got back.
 */
export const checkReachability = async ({
  request,
  callerAddress,
  resolveHost,
  fetchTarget,
}: CheckReachabilityProps): Promise<Response> => {
  const query = new URL(request.url).searchParams
  const host = query.get(REACHABILITY_PARAMS.host) ?? ''
  const port = Number(query.get(REACHABILITY_PARAMS.port) ?? '')
  const nonce = query.get(REACHABILITY_PARAMS.nonce) ?? ''
  if (!isPublicHostname(host) || !isPort(port) || !isEchoNonce(nonce)) {
    return answer({ body: { error: 'Give a DNS name, a port and a nonce.' }, status: 400 })
  }
  const seen = { publicAddress: callerAddress }
  const resolved = await resolveHost(host).catch(() => [])
  const unreachable = (problem: ReachabilityProblem) =>
    answer({ body: { state: REMOTE_ACCESS_STATES.unreachable, problem, ...seen, resolved } })
  if (resolved.length === 0) return unreachable(REACHABILITY_PROBLEMS.dns)
  if (resolved.some(isPrivateAddress)) return unreachable(REACHABILITY_PROBLEMS.privateAddress)
  const path = REMOTE_ACCESS_PATHS.echo.replace(`:${REMOTE_ACCESS_PARAMS.nonce}`, nonce)
  try {
    const response = await fetchTarget(`https://${host}:${port}${path}`, {
      redirect: 'manual',
      signal: AbortSignal.timeout(TARGET_TIMEOUT_MS),
    })
    await response.body?.cancel()
    if (response.status !== ECHO_ANSWERED) return unreachable(REACHABILITY_PROBLEMS.notRaven)
    return answer({ body: { state: REMOTE_ACCESS_STATES.reachable, ...seen, resolved } })
  } catch (error) {
    return unreachable(problemOf(error))
  }
}

const resolveWithDns: ResolveHost = async (host) =>
  (await lookup(host, { all: true })).map(({ address }) => address)

/** What Netlify hands a function beside the request: the caller's address among it. */
type NetlifyContext = { ip?: string }

// Netlify runs a function through its default export and routes by `config`.
export default (request: Request, context: NetlifyContext): Promise<Response> =>
  checkReachability({
    request,
    callerAddress: context.ip ?? null,
    resolveHost: resolveWithDns,
    fetchTarget: fetch,
  })

export const config = { path: REACHABILITY_CHECK_PATH, method: ['GET'] }
