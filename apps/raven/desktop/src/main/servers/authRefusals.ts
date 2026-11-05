import { AUTH_REFUSALS, isAuthRefusal, type AuthRefusal } from '@raven/core'
import { parseJson } from '@/main/parseJson'
import { OVERFLOWS, readCapped } from '@/main/servers/cappedBody'
import { HTTP_STATUSES } from '@/shared/httpStatuses'

/** What a refused request's body is read up to, for the reason it carries. */
const REFUSAL_MAX_CHARS = 4096

/** Reads a short body to its end or just past `REFUSAL_MAX_CHARS`, then lets go of the rest; a failed read is empty. */
export const readShort = (body: ReadableStream<Uint8Array> | null): Promise<string> =>
  readCapped({ body, maxChars: REFUSAL_MAX_CHARS, onOverflow: OVERFLOWS.truncate }).catch(() => '')

/** The reason a refused answer's body gives, or null when the body is no auth refusal. */
const refusalIn = (body: string): AuthRefusal['reason'] | null => {
  const parsed = parseJson(body)
  return isAuthRefusal(parsed) ? parsed.reason : null
}

/** The `401` and `403` a server refuses an account with. */
export const ACCOUNT_REFUSAL_STATUSES = [
  HTTP_STATUSES.unauthorized,
  HTTP_STATUSES.forbidden,
] as const

type RefusalAtProps = {
  status: number
  body: string
  statuses: readonly number[]
}

/** The reason a reply gives when its status is one of `statuses`; null for any other reply. */
export const refusalAt = ({
  status,
  body,
  statuses,
}: RefusalAtProps): AuthRefusal['reason'] | null =>
  statuses.includes(status) ? refusalIn(body) : null

type AccountRefusalOfProps = {
  status: number
  body: string
}

/** Why a `401` or `403` refused the account: the reason its body gives, or the one its status stands for. */
export const accountRefusalOf = ({ status, body }: AccountRefusalOfProps): AuthRefusal['reason'] =>
  refusalIn(body) ??
  (status === HTTP_STATUSES.unauthorized ? AUTH_REFUSALS.signedOut : AUTH_REFUSALS.revoked)
