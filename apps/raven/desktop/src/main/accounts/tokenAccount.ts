import { isString, object } from '@raven/core'
import { parseJson } from '@/main/parseJson'

const isClaims = object({ sub: isString })

/**
 * The account an access token was issued to: its JWT `sub`. The signature is the server's to
 * check; this only tells which account a call would go out as. Null for anything not a JWT.
 */
export const accountIdOfToken = (token: string): string | null => {
  const [, payload] = token.split('.')
  if (payload === undefined) return null
  const claims = parseJson(Buffer.from(payload, 'base64url').toString('utf8'))
  return isClaims(claims) ? claims.sub : null
}
