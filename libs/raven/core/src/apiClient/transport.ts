import {
  AUTH_API_PREFIX,
  AUTH_HEADERS,
  AUTH_SCHEME,
  HTTP_METHODS,
  type AuthRefusal,
  isAuthRefusal,
  MEDIA_TICKET_PARAM,
  type MediaOrigin,
} from '@/contract'
import { isUnreachableAnswer } from '@/desktop/webHost'
import { fillPath, pathWithQuery, toQueryString } from '@/query'
import { type PathParamName, type PathParams, type RouteMethod } from '@/routes'
import { type Guard, isRecord, isString, isStringArray } from '@/schema'
import { CONTENT_TYPES, HEADERS, HTTP_STATUSES } from '@shared/http'

/**
 * The slice of `fetch` the client uses, spelled out structurally so this
 * library needs no DOM or Node typings: the browser's `fetch`, Node's, and
 * React Native's all satisfy it.
 */
export type FetchInit = {
  method?: string
  headers?: Record<string, string>
  body?: string
}

export type FetchResponse = {
  ok: boolean
  status: number
  statusText: string
  json: () => Promise<unknown>
  text: () => Promise<string>
}

/** A media origin and the ticket that opens a video on it, which stands in for the cookie. */
export type MediaAccess = { origin: MediaOrigin; ticket: string }

/** What a media address is built from: an origin's address and the ticket it takes, whatever its kind. */
export type TicketedOrigin = { origin: Pick<MediaOrigin, 'url'>; ticket: string }

export type FetchLike = (url: string, init?: FetchInit) => Promise<FetchResponse>

type ApiErrorProps = {
  status: number
  message: string
  refusal?: AuthRefusal | null
  isServerUnreachable?: boolean
}

export class ApiError extends Error {
  readonly status: number
  readonly refusal: AuthRefusal | null
  /** Whether the answer came from in front of a server out of reach (see `isUnreachableAnswer`). */
  readonly isServerUnreachable: boolean

  constructor({ status, message, refusal = null, isServerUnreachable = false }: ApiErrorProps) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.refusal = refusal
    this.isServerUnreachable = isServerUnreachable
  }
}

/** HTTP's Locked: what the server answers for a locked library's videos until its PIN is entered. */
export const LOCKED_STATUS = HTTP_STATUSES.locked

/** A call refused because what it asked for sits in a locked library. */
export const isLockedError = (error: unknown): error is ApiError =>
  error instanceof ApiError && error.status === LOCKED_STATUS

type ErrorMessageProps = { body: unknown; fallback: string }

/** Nest's error body carries `message` as a string or, for validation, a list. */
const errorMessage = ({ body, fallback }: ErrorMessageProps): string => {
  if (!isRecord(body)) return fallback
  if (isString(body.message)) return body.message
  if (isStringArray(body.message)) return body.message.join(' ')
  return fallback
}

const readJson = async (response: FetchResponse): Promise<unknown> => {
  try {
    return await response.json()
  } catch {
    return null
  }
}

export type Transport = ReturnType<typeof createTransport>

/** A route's placeholders' values, which a route with none leaves out. */
type RouteParams<P extends string> = [PathParamName<P>] extends [never]
  ? { params?: undefined }
  : { params: PathParams<P> }

const CALL_KINDS = { api: 'api', media: 'media' } as const

const ACCEPTS = { json: CONTENT_TYPES.json, vtt: 'text/vtt' } as const

const REQUEST_FAILED = 'Request failed'

const NOT_UNDERSTOOD = 'The server sent a response this client does not understand.'

type CreateTransportProps = {
  baseUrl: string
  fetch: FetchLike
  accessToken: () => string | null
}

/**
 * How every call reaches the server: the address under `baseUrl`, the
 * Bearer on the server's own API, the server's message when it says no, and
 * the guard a response must pass before a caller sees it.
 */
export const createTransport = ({ baseUrl, fetch, accessToken }: CreateTransportProps) => {
  const root = baseUrl.replace(/(?<!\/)\/+$/, '')
  const url = (path: string): string => `${root}${path}`

  type MediaUrlProps = {
    path: string
    query: Record<string, string>
    access: TicketedOrigin | null
  }

  /** A media path on the origin `access` names, with its ticket; on this server's own without. */
  const mediaUrl = ({ path, query, access }: MediaUrlProps): string => {
    const queryString = toQueryString(
      access === null ? query : { ...query, [MEDIA_TICKET_PARAM]: access.ticket },
    )
    return `${access === null ? root : access.origin.url}${path}${queryString === '' ? '' : `?${queryString}`}`
  }

  /*
   * The server's own API, addressed by path under `baseUrl`, or a media address on
   * whatever origin it names, read as text.
   */
  type CallProps =
    | {
        kind: typeof CALL_KINDS.api
        path: string
        method: RouteMethod
        body: unknown
      }
    | { kind: typeof CALL_KINDS.media; href: string }

  /** Calls the server, failing with its own message when it says no. */
  const call = async (props: CallProps): Promise<FetchResponse> => {
    /*
     * Absolute media URLs are a separate trust boundary, even when their origin
     * happens to match the server. Only the generated API URL receives credentials.
     */
    const isApi = props.kind === CALL_KINDS.api
    const href = isApi ? url(props.path) : props.href
    const body = isApi ? props.body : undefined
    const token = isApi && props.path.startsWith(AUTH_API_PREFIX) ? accessToken() : null
    const accept = isApi ? ACCEPTS.json : ACCEPTS.vtt
    const response = await fetch(href, {
      method: isApi ? props.method : HTTP_METHODS.get,
      headers: {
        [HEADERS.accept]: accept,
        ...(body === undefined ? {} : { [HEADERS.contentType]: ACCEPTS.json }),
        ...(token === null ? {} : { [AUTH_HEADERS.authorization]: `${AUTH_SCHEME} ${token}` }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    if (!response.ok) {
      const responseBody = await readJson(response)
      throw new ApiError({
        status: response.status,
        message: errorMessage({
          body: responseBody,
          fallback: response.statusText === '' ? REQUEST_FAILED : response.statusText,
        }),
        refusal: isAuthRefusal(responseBody) ? responseBody : null,
        isServerUnreachable: isUnreachableAnswer({ status: response.status, body: responseBody }),
      })
    }
    return response
  }

  type SendProps = {
    path: string
    method?: RouteMethod
    body?: unknown
  }

  const send = async ({ path, method = HTTP_METHODS.get, body }: SendProps): Promise<unknown> => {
    const response = await call({ kind: CALL_KINDS.api, path, method, body })
    return response.status === HTTP_STATUSES.noContent ? null : readJson(response)
  }

  /** A plain-text body, such as WebVTT. */
  const sendForText = async (href: string): Promise<string> =>
    (await call({ kind: CALL_KINDS.media, href })).text()

  type ExpectProps<T> = {
    request: Promise<unknown>
    guard: Guard<T>
  }

  const expect = async <T>({ request, guard }: ExpectProps<T>): Promise<T> => {
    const value = await request
    if (!guard(value)) {
      throw new ApiError({ status: HTTP_STATUSES.badGateway, message: NOT_UNDERSTOOD })
    }
    return value
  }

  type RouteCallProps<P extends string> = {
    query?: Record<string, string>
    body?: unknown
  } & RouteParams<P>

  type AskProps<T, P extends string> = RouteCallProps<P> & {
    route: { method: RouteMethod; path: P; reply: Guard<T> }
  }

  type SendRouteProps<P extends string> = RouteCallProps<P> & {
    route: { method: RouteMethod; path: P }
  }

  /** Calls `route` with its placeholders filled and `query` after them. */
  const sendRoute = <P extends string>({
    route,
    params,
    query = {},
    body,
  }: SendRouteProps<P>): Promise<unknown> =>
    send({
      path: pathWithQuery({ path: fillPath({ path: route.path, params: params ?? {} }), query }),
      method: route.method,
      body,
    })

  /** Calls `route` and answers what it replied, once its guard says it is what the route sends. */
  const ask = <T, P extends string>(props: AskProps<T, P>): Promise<T> =>
    expect({ request: sendRoute(props), guard: props.route.reply })

  /** Calls `route` for what it does, not what it answers. */
  const tell = async <P extends string>(props: SendRouteProps<P>): Promise<void> => {
    await sendRoute(props)
  }

  return { url, mediaUrl, sendForText, ask, tell }
}
