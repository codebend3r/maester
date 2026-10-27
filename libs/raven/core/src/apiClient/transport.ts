import {
  AUTH_API_PREFIX,
  AUTH_HEADERS,
  AUTH_SCHEME,
  type AuthRefusal,
  isAuthRefusal,
  MEDIA_TICKET_PARAM,
  type MediaOrigin,
} from '@/contract'
import { isUnreachableAnswer } from '@/desktop/webHost'
import { toQueryString } from '@/query'
import { type Guard, isRecord, isString, isStringArray } from '@/schema'

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
export const LOCKED_STATUS = 423

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
  const root = baseUrl.replace(/\/+$/, '')
  const url = (path: string): string => `${root}${path}`

  type MediaUrlProps = {
    path: string
    query: Record<string, string>
    access: MediaAccess | null
  }

  /** A media path on the origin `access` names, with its ticket; on this server's own without. */
  const mediaUrl = ({ path, query, access }: MediaUrlProps): string => {
    const queryString = toQueryString(
      access === null ? query : { ...query, [MEDIA_TICKET_PARAM]: access.ticket },
    )
    return `${access === null ? root : access.origin.url}${path}${queryString === '' ? '' : `?${queryString}`}`
  }

  type CallProps = {
    path: string
    /** A full address, for the media origins; `path` is then unused. */
    href?: string
    method?: string
    accept?: string
    body?: unknown
  }

  /** Calls the server, failing with its own message when it says no. */
  const call = async ({
    path,
    href = url(path),
    method = 'GET',
    accept = 'application/json',
    body,
  }: CallProps): Promise<FetchResponse> => {
    // Absolute media URLs are a separate trust boundary, even when their origin
    // happens to match the server. Only the generated API URL receives credentials.
    const token = href === url(path) && path.startsWith(AUTH_API_PREFIX) ? accessToken() : null
    const response = await fetch(href, {
      method,
      headers: {
        ...(body === undefined ? { accept } : { accept, 'content-type': 'application/json' }),
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
          fallback: response.statusText || 'Request failed',
        }),
        refusal: isAuthRefusal(responseBody) ? responseBody : null,
        isServerUnreachable: isUnreachableAnswer({ status: response.status, body: responseBody }),
      })
    }
    return response
  }

  type SendProps = {
    path: string
    method?: string
    body?: unknown
  }

  const send = async (request: SendProps): Promise<unknown> => {
    const response = await call(request)
    return response.status === 204 ? null : readJson(response)
  }

  /** A plain-text body, such as WebVTT. */
  const sendForText = async (href: string): Promise<string> =>
    (await call({ path: '', href, accept: 'text/vtt' })).text()

  type ExpectProps<T> = {
    request: Promise<unknown>
    guard: Guard<T>
  }

  const expect = async <T>({ request, guard }: ExpectProps<T>): Promise<T> => {
    const value = await request
    if (!guard(value)) {
      throw new ApiError({
        status: 502,
        message: 'The server sent a response this client does not understand.',
      })
    }
    return value
  }

  type LibraryGetProps<T> = {
    libraryId: number
    path: string
    guard: Guard<T>
  }

  /** One of a library's lists, read at `path` under it. */
  const libraryGet = <T>({ libraryId, path, guard }: LibraryGetProps<T>): Promise<T> =>
    expect({ request: send({ path: `/api/libraries/${libraryId}/${path}` }), guard })

  return { url, mediaUrl, send, sendForText, expect, libraryGet }
}
