import { isPrivateAddress } from '@raven/core'
import type { FastifyRequest } from 'fastify'
import { RAVEN_HEADERS } from '@/http'

type ClientAddressOfProps = { request: Pick<FastifyRequest, 'ip' | 'headers'> }

/**
 * Where a request came from, as far as raven can trust it. A socket on a
 * public address is the client itself. A socket on a private one is the LAN,
 * or the reverse proxy and Docker's bridge in front of raven, so the last
 * `X-Forwarded-For` entry wins: the one the proxy appended for its own peer.
 * Whatever a client writes in the header itself stands before that entry, so
 * it can not pass for a viewer at home.
 */
export const clientAddressOf = ({ request }: ClientAddressOfProps): string => {
  if (!isPrivateAddress(request.ip)) return request.ip
  const header = request.headers[RAVEN_HEADERS.forwardedFor]
  const forwarded = (Array.isArray(header) ? header.join(',') : (header ?? ''))
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')
  return forwarded.at(-1) ?? request.ip
}

/** Whether a request comes from the home network: not from the internet, and not through Netlify's proxy. */
export const isLanRequest = ({ request }: ClientAddressOfProps): boolean =>
  isPrivateAddress(clientAddressOf({ request }))
