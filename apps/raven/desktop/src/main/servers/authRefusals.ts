import { AUTH_REFUSALS, type AuthRefusal, type Infer, isAuthRefusal, oneOf } from '@raven/core'
import { parseJson } from '@/main/parseJson'
import { OVERFLOWS, readCapped } from '@/main/servers/cappedBody'
import { HTTP_STATUSES } from '@shared/http'

/** What a refused request's body is read up to, for the reason it carries. */
const REFUSAL_MAX_CHARS = 4096

/** Reads a short body to its end or just past `REFUSAL_MAX_CHARS`, then lets go of the rest; a failed read is empty. */
export const readShort = (body: ReadableStream<Uint8Array> | null): Promise<string> =>
  readCapped({ body, maxChars: REFUSAL_MAX_CHARS, onOverflow: OVERFLOWS.truncate }).catch(() => '')

/** A refusal of the account itself; `unavailable` is the server's outage, not the account's. */
export const isAccountRefusal = oneOf([
  AUTH_REFUSALS.signedOut,
  AUTH_REFUSALS.pending,
  AUTH_REFUSALS.revoked,
  AUTH_REFUSALS.notOwner,
] as const satisfies readonly Exclude<AuthRefusal['reason'], typeof AUTH_REFUSALS.unavailable>[])

export type AccountRefusal = Infer<typeof isAccountRefusal>

/** What a `401` or `403` with no reason of its own stands for. */
const REFUSAL_BY_STATUS: ReadonlyMap<number, AccountRefusal> = new Map([
  [HTTP_STATUSES.unauthorized, AUTH_REFUSALS.signedOut],
  [HTTP_STATUSES.forbidden, AUTH_REFUSALS.revoked],
])

type AccountRefusalOfProps = {
  status: number
  body: string
}

/**
 * Why a `401` or `403` refused the account: the reason its body gives, or the one its status
 * stands for. Null for any other status, and for accounts that are down, which are the server's
 * outage rather than a refusal of this account.
 */
export const accountRefusalOf = ({
  status,
  body,
}: AccountRefusalOfProps): AccountRefusal | null => {
  const byStatus = REFUSAL_BY_STATUS.get(status)
  if (byStatus === undefined) return null
  const parsed = parseJson(body)
  if (!isAuthRefusal(parsed)) return byStatus
  return isAccountRefusal(parsed.reason) ? parsed.reason : null
}
