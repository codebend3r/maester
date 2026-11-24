import { HEADERS, HTTP_STATUSES, type HttpMethod } from '@shared/server'
import type { FastifyReply, FastifyRequest } from 'fastify'

/** The CORS headers raven reads and sends, in lower case as Node hands incoming ones over. */
export const CORS_HEADERS = {
  origin: 'origin',
  allowOrigin: 'access-control-allow-origin',
  allowMethods: 'access-control-allow-methods',
  allowHeaders: 'access-control-allow-headers',
  allowCredentials: 'access-control-allow-credentials',
  allowPrivateNetwork: 'access-control-allow-private-network',
  exposeHeaders: 'access-control-expose-headers',
  maxAge: 'access-control-max-age',
  requestMethod: 'access-control-request-method',
  requestPrivateNetwork: 'access-control-request-private-network',
} as const

/** What a yes-or-no CORS header says for yes. */
export const CORS_FLAGS = { true: 'true' } as const

/** How `Vary` names the header a CORS answer depends on. */
export const VARIES = { origin: 'Origin' } as const

/** How long a browser may keep a preflight's answer, in seconds. */
const PREFLIGHT_MAX_AGE = '600'

/** Whether a request's `Origin` is one of the web origins in `RAVEN_WEB_ORIGINS`. */
export type AllowedOriginCheck = (origin: string | undefined) => boolean

/**
 * What a group of routes allows a page on another origin: the methods it may
 * call and the headers it may send, which the preflight answers, and the
 * response headers its script may read beyond the ones every page may.
 */
export type CorsPolicy = {
  methods: readonly HttpMethod[]
  requestHeaders: readonly string[]
  exposedHeaders: readonly string[]
}

/** A reply's `Vary` as Fastify hands it over. */
type VaryValue = ReturnType<FastifyReply['getHeader']>

/** `existing` Vary with `Origin` added once, keeping what compression and others put there. */
const withOrigin = (existing: VaryValue): string => {
  const current = Array.isArray(existing) ? existing.join(', ') : String(existing ?? '')
  const names = current.split(',').map((name) => name.trim().toLowerCase())
  if (names.includes(CORS_HEADERS.origin)) return current
  return current === '' ? VARIES.origin : `${current}, ${VARIES.origin}`
}

type ResponseHeadersProps = {
  origin: string
  policy: CorsPolicy
  /** The reply's `Vary` so far, which keeps its names beside `Origin`. */
  vary?: VaryValue
}

/** What the answer to a call from an allowed origin carries under `policy`; never credentials. */
export const responseHeaders = ({
  origin,
  policy,
  vary,
}: ResponseHeadersProps): Record<string, string> => ({
  [CORS_HEADERS.allowOrigin]: origin,
  [HEADERS.vary]: withOrigin(vary),
  ...(policy.exposedHeaders.length === 0
    ? {}
    : { [CORS_HEADERS.exposeHeaders]: policy.exposedHeaders.join(', ') }),
})

type PreflightHeadersProps = {
  origin: string
  wantsPrivateNetwork: boolean
  policy: CorsPolicy
}

export const preflightHeaders = ({
  origin,
  wantsPrivateNetwork,
  policy,
}: PreflightHeadersProps): Record<string, string> => ({
  [CORS_HEADERS.allowOrigin]: origin,
  [HEADERS.vary]: VARIES.origin,
  [CORS_HEADERS.allowMethods]: policy.methods.join(', '),
  [CORS_HEADERS.allowHeaders]: policy.requestHeaders.join(', '),
  [CORS_HEADERS.maxAge]: PREFLIGHT_MAX_AGE,
  ...(wantsPrivateNetwork ? { [CORS_HEADERS.allowPrivateNetwork]: CORS_FLAGS.true } : {}),
})

type AnswerPreflightProps = {
  request: FastifyRequest
  reply: FastifyReply
  origin: string
  policy: CorsPolicy
}

/** Answers a preflight from an allowed origin with `policy`, and the private network allowance when asked. */
export const answerPreflight = ({
  request,
  reply,
  origin,
  policy,
}: AnswerPreflightProps): FastifyReply =>
  reply
    .headers(
      preflightHeaders({
        origin,
        wantsPrivateNetwork:
          request.headers[CORS_HEADERS.requestPrivateNetwork] === CORS_FLAGS.true,
        policy,
      }),
    )
    .code(HTTP_STATUSES.noContent)
    .send()
