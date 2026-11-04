import { describe, expect, it, mock, spyOn } from 'bun:test'
import { proxyPicture } from '@/netlify/functions/pictures/pictures'

const ORIGIN = 'https://raven.example.ts.net'
const PICTURE = 'https://raven-player.netlify.app/api/pictures/items/4/backdrop/abc'

type UpstreamProps = { status?: number; type?: string }

const upstream = ({ status = 200, type = 'image/jpeg' }: UpstreamProps = {}) =>
  mock(
    async (_url: URL, _init: { method: string }) =>
      new Response('bytes', { status, headers: { 'content-type': type } }),
  )

describe('proxyPicture', () => {
  it("fetches the picture's path from raven and keeps it in the durable cache across deploys", async () => {
    const fetchUpstream = upstream()
    const response = await proxyPicture({
      request: new Request(`${PICTURE}?utm=1`),
      origin: ORIGIN,
      fetchUpstream,
    })
    expect(fetchUpstream).toHaveBeenCalledWith(
      new URL(`${ORIGIN}/api/pictures/items/4/backdrop/abc`),
      {
        method: 'GET',
      },
    )
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('bytes')
    expect(response.headers.get('content-type')).toBe('image/jpeg')
    expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    expect(response.headers.get('netlify-cdn-cache-control')).toBe(
      'public, durable, max-age=31536000, immutable',
    )
    expect(response.headers.get('netlify-cache-id')).toBe('raven-pictures')
  })

  it('passes a refusal on with its status, kept by no cache', async () => {
    const response = await proxyPicture({
      request: new Request(PICTURE),
      origin: ORIGIN,
      fetchUpstream: upstream({ status: 404 }),
    })
    expect(response.status).toBe(404)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('netlify-cdn-cache-control')).toBe('no-store')
    expect(response.headers.get('netlify-cache-id')).toBeNull()
  })

  it("answers 502 without raven's origin, fetching nothing", async () => {
    const quiet = spyOn(console, 'error').mockImplementation(() => {})
    const fetchUpstream = upstream()
    const response = await proxyPicture({
      request: new Request(PICTURE),
      origin: undefined,
      fetchUpstream,
    })
    expect(response.status).toBe(502)
    expect(fetchUpstream).not.toHaveBeenCalled()
    quiet.mockRestore()
  })

  it('asks raven with the method it was asked with', async () => {
    const fetchUpstream = upstream()
    await proxyPicture({
      request: new Request(PICTURE, { method: 'HEAD' }),
      origin: ORIGIN,
      fetchUpstream,
    })
    expect(fetchUpstream).toHaveBeenCalledWith(expect.any(URL), { method: 'HEAD' })
  })
})
