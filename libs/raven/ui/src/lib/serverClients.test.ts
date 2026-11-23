import { describe, expect, it } from 'bun:test'
import {
  AUTH_HEADERS,
  AUTH_SCHEME,
  type FetchInit,
  type FetchResponse,
  ITEM_IMAGE_KINDS,
} from '@raven/core'
import { HTTP_STATUSES } from '@shared/http'
import { serverClientsFor } from '@/lib/serverClients'
import { useActiveServer } from '@/stores/activeServer'
import { MELEYS } from '@/test/fixtures'

type Call = { url: string; init: FetchInit | undefined }

const answering = () => {
  const calls: Call[] = []
  const fetch = async (url: string, init?: FetchInit): Promise<FetchResponse> => {
    calls.push({ url, init })
    return {
      ok: true,
      status: HTTP_STATUSES.ok,
      statusText: 'OK',
      json: async () => [],
      text: async () => '',
    }
  }
  return { calls, fetch }
}

describe('serverClientsFor', () => {
  it('calls whichever server is active, with the Bearer either way', async () => {
    const { calls, fetch } = answering()
    const { active } = serverClientsFor({ fetch, accessToken: () => 'token' })
    await active.listLibraries()
    useActiveServer.getState().choose(MELEYS)
    await active.listLibraries()
    expect(calls.map(({ url }) => url)).toEqual([
      '/api/libraries',
      'https://meleys.example:8443/api/libraries',
    ])
    expect(calls.map(({ init }) => init?.headers?.[AUTH_HEADERS.authorization] ?? null)).toEqual([
      `${AUTH_SCHEME} token`,
      `${AUTH_SCHEME} token`,
    ])
  })

  it("calls the page's own `/api` for every server when that relays to the active one", async () => {
    const { calls, fetch } = answering()
    const { active } = serverClientsFor({
      fetch,
      accessToken: () => 'token',
      isRelayed: () => true,
    })
    useActiveServer.getState().choose(MELEYS)
    await active.listLibraries()
    expect(calls.map(({ url }) => url)).toEqual(['/api/libraries'])
  })

  it("sends home's pictures through the CDN and another server's straight from it", () => {
    const { fetch } = answering()
    const { active } = serverClientsFor({ fetch, accessToken: () => null, pictureCdn: '/cdn' })
    const poster = { id: 2, kind: ITEM_IMAGE_KINDS.poster, version: 'abc' } as const
    expect(active.itemImageUrl(poster)).toStartWith('/cdn?')
    useActiveServer.getState().choose(MELEYS)
    expect(active.itemImageUrl(poster)).toBe(
      'https://meleys.example:8443/api/pictures/items/2/poster/abc',
    )
  })

  it('keeps one client for each origin, at that origin whatever is active', async () => {
    const { calls, fetch } = answering()
    const { at } = serverClientsFor({ fetch, accessToken: () => null })
    expect(at(MELEYS.origin)).toBe(at(MELEYS.origin))
    await at(MELEYS.origin).listLibraries()
    expect(calls[0]?.url ?? null).toBe('https://meleys.example:8443/api/libraries')
  })
})
