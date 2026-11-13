import { isPrivateAddress } from '@raven/core'
import type { FastifyRequest } from 'fastify'
import { headerOf } from '@/http'
import { HEADERS } from '@shared/server'

/**
 * What raven reads of a request to tell where it came from: Fastify's
 * proxy-aware `ip` and `ips`, and the headers a proxy forwards. Every reader
 * of the client's address takes this one shape, so none can lean on a part
 * of the request the others do not see.
 */
export type ClientRequest = Pick<FastifyRequest, 'ip' | 'ips' | 'headers'>

type ClientRequestProps = { request: ClientRequest }

/**
 * Where a request came from, as far as raven can trust it. Fastify's
 * `trustProxy` (`RAVEN_TRUSTED_PROXIES`) has already walked
 * `X-Forwarded-For` from the right past the trusted proxies, so `ip` is the
 * first address no trusted proxy stands for: the socket itself when it is
 * not one of them, whatever the header says.
 */
export const clientAddressOf = ({ request }: ClientRequestProps): string => request.ip

/**
 * Whether a trusted proxy vouched for the client's address: Fastify's `ips`
 * holds the socket and each address the trusted hops forwarded, so more than
 * one means raven sees past its proxy.
 */
export const isAddressForwarded = ({ request }: ClientRequestProps): boolean =>
  (request.ips?.length ?? 0) > 1

const hasForwardedHeader = ({ request }: ClientRequestProps): boolean =>
  headerOf(request.headers[HEADERS.forwardedFor])
    .split(',')
    .some((entry) => entry.trim() !== '')

/**
 * Whether a request comes from the home network: a private address raven
 * can stand behind. A private socket that forwards an `X-Forwarded-For`
 * raven was not told to trust is a proxy raven can not see past, so it is
 * taken for the internet, never for home.
 */
export const isLanRequest = ({ request }: ClientRequestProps): boolean => {
  const address = clientAddressOf({ request })
  if (!isPrivateAddress(address)) return false
  return !hasForwardedHeader({ request }) || isAddressForwarded({ request })
}
