import { type FetchResponse, LOCKED_STATUS, isString } from '@raven/core'
import { HTTP_STATUSES } from '@shared/http'

/** The statuses the test servers answer with. */
export const STATUSES = {
  ok: HTTP_STATUSES.ok,
  noContent: HTTP_STATUSES.noContent,
  unauthorized: HTTP_STATUSES.unauthorized,
  forbidden: HTTP_STATUSES.forbidden,
  notFound: HTTP_STATUSES.notFound,
  conflict: HTTP_STATUSES.conflict,
  locked: LOCKED_STATUS,
  failed: HTTP_STATUSES.internalServerError,
  unavailable: HTTP_STATUSES.unavailable,
} as const

/** How a test server answers: a status, and the body it sends with it. */
export type Answer = { status: number; body: unknown }

/** The answer to a path the test server does not know. */
export const NOT_FOUND: Answer = { status: STATUSES.notFound, body: { message: 'Not found' } }

/** The `:id` placeholder in the allowlist's paths. */
const ID_PARAM = ':id'

type PathWithIdProps = { path: string; id: number }

/** A route's path for one id: `/api/items/40`. */
export const pathWithId = ({ path, id }: PathWithIdProps): string =>
  path.replace(ID_PARAM, String(id))

const isSuccess = (status: number): boolean => status >= 200 && status < 300

/** A request a test server heard: its method, its path and query, and what it was sent. */
export type HeardRequest = { method: string; path: string; body: unknown }

type ResponseOfProps = Answer

/** `answer` as `fetch` hands it back: `ok` for any 2xx, as the platform's is. */
export const responseOf = ({ status, body }: ResponseOfProps): FetchResponse => ({
  ok: isSuccess(status),
  status,
  statusText: isSuccess(status) ? 'OK' : 'Refused',
  json: async () => body,
  // A text body, as WebVTT is, goes as it is; anything else as JSON.
  text: async () => (isString(body) ? body : JSON.stringify(body)),
})
