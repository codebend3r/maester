import { describe, expect, it } from 'vitest'
import { RAVEN_HEADERS } from '@/http'
import { clientAddressOf, isAddressForwarded, isLanRequest } from '@/remoteAccess/clientNetwork'
import { TRUSTED_PROXY } from '@/test/app'

/** DSM's reverse proxy on raven's Docker network, the one proxy these requests trust. */
const PROXY = TRUSTED_PROXY

type RequestProps = { ip: string; ips?: string[]; forwardedFor?: string | string[] }

/** A request as Fastify's `trustProxy` hands it over: `ip` already walked past the trusted proxies. */
const request = ({ ip, ips = [ip], forwardedFor }: RequestProps) => ({
  ip,
  ips,
  headers: forwardedFor === undefined ? {} : { [RAVEN_HEADERS.forwardedFor]: forwardedFor },
})

describe('clientAddressOf', () => {
  it('is the address Fastify resolved, whatever the header says', () => {
    expect(
      clientAddressOf({ request: request({ ip: '198.51.100.20', forwardedFor: '10.0.0.5' }) }),
    ).toBe('198.51.100.20')
  })
})

describe('isAddressForwarded', () => {
  it('is a trusted proxy standing for the client', () => {
    expect(
      isAddressForwarded({
        request: request({ ip: '198.51.100.20', ips: [PROXY, '198.51.100.20'] }),
      }),
    ).toBe(true)
  })

  it('is not a socket raven does not trust, nor a trusted proxy that forwards nothing', () => {
    expect(
      isAddressForwarded({ request: request({ ip: '10.0.0.9', forwardedFor: '198.51.100.20' }) }),
    ).toBe(false)
    expect(isAddressForwarded({ request: request({ ip: PROXY }) })).toBe(false)
    expect(isAddressForwarded({ request: { ip: PROXY, headers: {} } })).toBe(false)
  })
})

describe('isLanRequest', () => {
  it('is a viewer at home on the LAN or through the trusted proxy from it', () => {
    expect(isLanRequest({ request: request({ ip: '192.168.50.20' }) })).toBe(true)
    expect(
      isLanRequest({
        request: request({
          ip: '192.168.50.20',
          ips: [PROXY, '192.168.50.20'],
          forwardedFor: '192.168.50.20',
        }),
      }),
    ).toBe(true)
  })

  it('is not a viewer away, nor one whose proxy raven does not trust', () => {
    expect(
      isLanRequest({
        request: request({
          ip: '198.51.100.20',
          ips: [PROXY, '198.51.100.20'],
          forwardedFor: '192.168.1.5, 198.51.100.20',
        }),
      }),
    ).toBe(false)
    expect(isLanRequest({ request: request({ ip: '203.0.113.4' }) })).toBe(false)
    expect(
      isLanRequest({ request: request({ ip: '172.18.0.1', forwardedFor: '198.51.100.20' }) }),
    ).toBe(false)
    expect(
      isLanRequest({ request: request({ ip: '172.18.0.1', forwardedFor: ['', '192.168.1.5'] }) }),
    ).toBe(false)
  })

  it('takes an empty header for none, and an entry that is no address for the internet', () => {
    expect(isLanRequest({ request: request({ ip: '127.0.0.1', forwardedFor: ' , ' }) })).toBe(true)
    expect(
      isLanRequest({
        request: request({ ip: 'unknown', ips: [PROXY, 'unknown'], forwardedFor: 'unknown' }),
      }),
    ).toBe(false)
  })
})
