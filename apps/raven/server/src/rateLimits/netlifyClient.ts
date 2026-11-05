import { isIP } from 'node:net'
import { jwtVerify } from 'jose'
import { headerOf } from '@/http'
import type { ClientRequest } from '@/remoteAccess/clientNetwork'

/**
 * What Netlify's signed proxy adds to each request it passes on: `x-nf-sign`,
 * an HS256 JWS keyed with the site's `RAVEN_PROXY_SECRET` (`signed` in
 * `apps/raven/web/netlify.toml`), and the address the visitor called from.
 */
export const NETLIFY_HEADERS = {
  sign: 'x-nf-sign',
  clientAddress: 'x-nf-client-connection-ip',
} as const

/** What Netlify writes in a signed proxy request's `iss`. */
const NETLIFY_ISSUER = 'netlify'

/** The algorithm Netlify signs proxy requests with; no other is taken. */
const NETLIFY_ALGORITHMS = ['HS256']

/** The claims a signature must carry, so one can not be replayed past its expiry. */
const REQUIRED_CLAIMS = ['exp']

type NetlifyClientOfProps = {
  request: ClientRequest
  /** The secret Netlify signs with; null when the server has none, and no request is believed. */
  secret: Uint8Array | null
}

/**
 * The visitor's own address on a request Netlify's proxy passed on, or null
 * for any other. Every visitor of the Netlify site reaches raven from
 * Netlify's few addresses, so counting them by those would let one of them
 * spend everyone's budget. Netlify's address headers can be written by
 * anyone who calls the public origin directly, so they are believed only
 * beside a valid signature, which only Netlify, holding the secret, makes,
 * and only `x-nf-client-connection-ip`: no place in `X-Forwarded-For` is
 * taken on trust. Without it the visitor is counted by Netlify's address.
 */
export const netlifyClientOf = async ({
  request,
  secret,
}: NetlifyClientOfProps): Promise<string | null> => {
  const signature = headerOf(request.headers[NETLIFY_HEADERS.sign])
  if (secret === null || signature === '') return null
  try {
    await jwtVerify(signature, secret, {
      issuer: NETLIFY_ISSUER,
      algorithms: NETLIFY_ALGORITHMS,
      requiredClaims: REQUIRED_CLAIMS,
    })
  } catch {
    return null
  }
  const stated = headerOf(request.headers[NETLIFY_HEADERS.clientAddress])
  return isIP(stated) === 0 ? null : stated
}
