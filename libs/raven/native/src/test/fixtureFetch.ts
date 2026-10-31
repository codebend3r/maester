import { type FetchResponse, LOCKED_STATUS, isString } from '@raven/core'

/** The statuses the test servers answer with. */
export const STATUSES = {
  ok: 200,
  noContent: 204,
  unauthorized: 401,
  forbidden: 403,
  notFound: 404,
  conflict: 409,
  locked: LOCKED_STATUS,
  failed: 500,
  unavailable: 503,
} as const

/** How a test server answers: a status, and the body it sends with it. */
export type Answer = { status: number; body: unknown }

/** The answer to a path the test server does not know. */
export const NOT_FOUND: Answer = { status: STATUSES.notFound, body: { message: 'Not found' } }

/** The `:id` placeholder in the allowlist's paths. */
const ID_PARAM = ':id'

type PathForProps = { path: string; id: number }

/** A route's path for one id: `/api/items/40`. */
export const pathFor = ({ path, id }: PathForProps): string => path.replace(ID_PARAM, String(id))

const isSuccess = (status: number): boolean => status >= 200 && status < 300

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
