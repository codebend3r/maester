import { AUTH_REFUSALS, isAuthRefusal, type AuthRefusal } from '@raven/core'
import { parseJson } from '@/main/parseJson'
import { HTTP_STATUSES } from '@/shared/httpStatuses'

/** What a refused request's body is read up to, for the reason it carries. */
const REFUSAL_MAX_CHARS = 4096

/** Reads a short body to its end or to `REFUSAL_MAX_CHARS`, then lets go of the rest. */
export const readShort = async (body: ReadableStream<Uint8Array> | null): Promise<string> => {
  if (body === null) return ''
  const reader = body.getReader()
  const decoder = new TextDecoder()
  const readFrom = async (text: string): Promise<string> => {
    const { done, value } = await reader.read()
    if (done) return `${text}${decoder.decode()}`
    const next = `${text}${decoder.decode(value, { stream: true })}`
    return next.length >= REFUSAL_MAX_CHARS ? next : readFrom(next)
  }
  try {
    return await readFrom('')
  } catch {
    return ''
  } finally {
    await reader.cancel().catch(() => undefined)
  }
}

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
