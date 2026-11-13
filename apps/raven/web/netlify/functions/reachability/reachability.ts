import { createHmac, timingSafeEqual } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { request as httpsRequest } from 'node:https'
import { type LookupFunction, isIP } from 'node:net'
import {
  REACHABILITY_PROBLEMS,
  REACHABILITY_TIMINGS,
  REMOTE_ACCESS_PARAMS,
  REMOTE_ACCESS_PATHS,
  REMOTE_ACCESS_STATES,
  type ReachabilityProblem,
  type ReachabilityQuery,
  type ReachabilityReport,
  fillPath,
  isPrivateAddress,
  isRecord,
  isString,
  readReachabilityQuery,
} from '@raven/core'
import { CACHE_POLICIES, HEADERS, HTTP_METHODS, HTTP_STATUSES } from '@shared/http'

/** The site's environment variables the function reads, scoped to Runtime. */
const ENV = { proxySecret: 'RAVEN_PROXY_SECRET' } as const

/** How raven signs a check's nonce, with the secret the site's /api proxy signs with too. */
const SIGNATURE = { algorithm: 'sha256', encoding: 'hex' } as const

/** The events of Node's outgoing request the check listens for. */
const REQUEST_EVENTS = { response: 'response', error: 'error' } as const

/** What raven's echo answers a nonce a check in flight holds. */
const ECHO_ANSWERED = HTTP_STATUSES.noContent

/** The `name` the check's own deadline fails with, as `AbortSignal.timeout`'s does. */
const TIMEOUT_ERROR = 'TimeoutError'

/** Node's codes for a connection that never answered. */
const TIMEOUT_CODES = new Set(['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT'])

/** Node's codes for a name that does not resolve. */
const DNS_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ENODATA'])

/** What a request's TLS failures have in their code: an untrusted, expired or misnamed certificate. */
const CERTIFICATE_CODE = /CERT|SSL|TLS|SELF_SIGNED|UNABLE_TO_VERIFY|UNABLE_TO_GET_ISSUER/

/** The one lookup the check makes; `dns.lookup` with `all` is one. */
type ResolveHost = (host: string) => Promise<string[]>

/** Where the check asks raven: the host the certificate must name, at the address the check vetted. */
type Target = { host: string; address: string; port: number; path: string }

/** The one call the check makes to raven, answering the status it got; `requestPinned` is one. */
type ConnectTarget = (target: Target) => Promise<number>

type CheckReachabilityProps = {
  request: Request
  /** The address the call came from: the home network's, when raven asks. */
  callerAddress: string | null
  /** The secret raven signs a check's nonce with; null when the site has none. */
  secret: string | null
  resolveHost: ResolveHost
  connectTarget: ConnectTarget
}

/** What the check answers: a report, or why it would not look. */
type Answer = ReachabilityReport | { error: string }

type AnswerProps = { body: Answer; status?: number }

const answer = ({ body, status = 200 }: AnswerProps): Response =>
  Response.json(body, { status, headers: { [HEADERS.cacheControl]: CACHE_POLICIES.noStore } })

type IsSignedProps = { query: ReachabilityQuery; secret: string | null }

/** Whether raven, holding the secret, signed the query's nonce; compared in constant time. */
const isSigned = ({ query, secret }: IsSignedProps): boolean => {
  if (!secret) return false
  const expected = createHmac(SIGNATURE.algorithm, secret)
    .update(query.nonce)
    .digest(SIGNATURE.encoding)
  // Both are 64 hex digits, the query's guard says, so the lengths timingSafeEqual needs agree.
  return timingSafeEqual(Buffer.from(expected), Buffer.from(query.signature))
}

/** The `code` of an error, or of the error it wraps, as undici's `fetch failed` wraps Node's. */
const codeOf = (error: unknown): string => {
  if (!isRecord(error)) return ''
  if (isString(error.code)) return error.code
  return isRecord(error.cause) ? codeOf(error.cause) : ''
}

/** Why the request for raven's echo failed, in the check's words. */
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
 * raven can not test from inside its own network. Only raven signs a check,
 * with the secret it shares with the site, so no one else can make the
 * function probe a host. Only raven, holding the nonce of a check it started,
 * answers its echo with a 204, so anything else that answers is not it. The
 * check takes a DNS name and a port and nothing else, refuses a name that
 * resolves to a private address (Netlify's own network included), connects to
 * the address it vetted rather than resolving the name again (so a rebinding
 * name can not slip a private address past it), asks one fixed path without
 * following redirects, and passes on no byte of what it got back.
 */
export const checkReachability = async ({
  request,
  callerAddress,
  secret,
  resolveHost,
  connectTarget,
}: CheckReachabilityProps): Promise<Response> => {
  const query = readReachabilityQuery(new URL(request.url).search)
  if (query === null) {
    return answer({
      body: { error: 'Give a DNS name, a port, a nonce and its signature.' },
      status: 400,
    })
  }
  if (!isSigned({ query, secret })) {
    return answer({ body: { error: 'Only raven may ask for a check.' }, status: 403 })
  }
  const { host, port, nonce } = query
  const seen = { publicAddress: callerAddress }
  const resolved = await resolveHost(host).catch((): string[] => [])
  const unreachable = (problem: ReachabilityProblem) =>
    answer({ body: { state: REMOTE_ACCESS_STATES.unreachable, problem, ...seen, resolved } })
  const [address] = resolved
  if (address === undefined) return unreachable(REACHABILITY_PROBLEMS.dns)
  if (resolved.some(isPrivateAddress)) return unreachable(REACHABILITY_PROBLEMS.privateAddress)
  const path = fillPath({
    path: REMOTE_ACCESS_PATHS.echo,
    params: { [REMOTE_ACCESS_PARAMS.nonce]: nonce },
  })
  try {
    const status = await connectTarget({ host, address, port, path })
    if (status !== ECHO_ANSWERED) return unreachable(REACHABILITY_PROBLEMS.notRaven)
    return answer({ body: { state: REMOTE_ACCESS_STATES.reachable, ...seen, resolved } })
  } catch (error) {
    return unreachable(problemOf(error))
  }
}

const resolveWithDns: ResolveHost = async (host) =>
  (await lookup(host, { all: true })).map(({ address }) => address)

/** A lookup that answers the one address the check vetted, whatever name it is asked. */
const pinnedLookup =
  (address: string): LookupFunction =>
  (_hostname, options, callback) => {
    const family = isIP(address)
    if (options.all) {
      callback(null, [{ address, family }])
      return
    }
    callback(null, address, family)
  }

/**
 * An https GET of the target's path at its vetted address. TLS still names
 * the host, so the certificate is checked for it; a redirect is answered as
 * its status, never followed; the body is read off and dropped; the whole
 * request has `REACHABILITY_TIMINGS.targetTimeoutMs` to answer.
 */
const requestPinned: ConnectTarget = ({ host, address, port, path }) =>
  new Promise((resolve, reject) => {
    const outgoing = httpsRequest({
      host,
      port,
      path,
      method: HTTP_METHODS.get,
      servername: host,
      lookup: pinnedLookup(address),
    })
    const deadline = setTimeout(
      () => outgoing.destroy(new DOMException('raven did not answer in time', TIMEOUT_ERROR)),
      REACHABILITY_TIMINGS.targetTimeoutMs,
    )
    outgoing.on(REQUEST_EVENTS.response, (response) => {
      clearTimeout(deadline)
      response.resume()
      resolve(response.statusCode ?? 0)
    })
    outgoing.on(REQUEST_EVENTS.error, (error) => {
      clearTimeout(deadline)
      reject(error)
    })
    outgoing.end()
  })

/** What Netlify hands a function beside the request: the caller's address among it. */
type NetlifyContext = { ip?: string }

// Netlify runs a function through its default export and routes by `config`.
export default (request: Request, context: NetlifyContext): Promise<Response> =>
  checkReachability({
    request,
    callerAddress: context.ip ?? null,
    secret: process.env[ENV.proxySecret] ?? null,
    resolveHost: resolveWithDns,
    connectTarget: requestPinned,
  })

/**
 * Netlify reads `config` without running the module, so it sees only literals: a constant here
 * arrives as nothing and fails the deploy. The test holds the path to core's
 * `REACHABILITY_CHECK_PATH`.
 */
export const config = { path: '/remote-access/check', method: ['GET'] }
