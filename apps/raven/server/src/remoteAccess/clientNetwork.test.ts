import { describe, expect, it } from 'vitest'
import { RAVEN_HEADERS } from '@/http'
import { clientAddressOf, isLanRequest } from '@/remoteAccess/clientNetwork'

type RequestProps = { ip: string; forwardedFor?: string | string[] }

const request = ({ ip, forwardedFor }: RequestProps) => ({
  ip,
  headers: forwardedFor === undefined ? {} : { [RAVEN_HEADERS.forwardedFor]: forwardedFor },
})

describe('clientAddressOf', () => {
  it('takes a public socket as the client, whatever the header says', () => {
    expect(
      clientAddressOf({ request: request({ ip: '198.51.100.20', forwardedFor: '10.0.0.5' }) }),
    ).toBe('198.51.100.20')
  })

  it("takes the proxy's own entry, the last, behind a private socket", () => {
    expect(
      clientAddressOf({
        request: request({ ip: '::ffff:172.17.0.1', forwardedFor: '192.168.1.9, 198.51.100.20' }),
      }),
    ).toBe('198.51.100.20')
    expect(
      clientAddressOf({
        request: request({ ip: '172.17.0.1', forwardedFor: ['10.0.0.1', '203.0.113.4'] }),
      }),
    ).toBe('203.0.113.4')
  })

  it('takes the socket on the LAN with nothing forwarded', () => {
    expect(clientAddressOf({ request: request({ ip: '192.168.50.20' }) })).toBe('192.168.50.20')
    expect(clientAddressOf({ request: request({ ip: '127.0.0.1', forwardedFor: ' , ' }) })).toBe(
      '127.0.0.1',
    )
  })
})

describe('isLanRequest', () => {
  it('is a viewer at home on the LAN or through the reverse proxy from it', () => {
    expect(isLanRequest({ request: request({ ip: '192.168.50.20' }) })).toBe(true)
    expect(
      isLanRequest({ request: request({ ip: '172.17.0.1', forwardedFor: '192.168.50.20' }) }),
    ).toBe(true)
  })

  it("is not a viewer away, nor Netlify's proxy, nor one who forges the header", () => {
    expect(
      isLanRequest({ request: request({ ip: '172.17.0.1', forwardedFor: '198.51.100.20' }) }),
    ).toBe(false)
    expect(
      isLanRequest({
        request: request({ ip: '172.17.0.1', forwardedFor: '192.168.1.5, 198.51.100.20' }),
      }),
    ).toBe(false)
    expect(isLanRequest({ request: request({ ip: '203.0.113.4' }) })).toBe(false)
  })
})
