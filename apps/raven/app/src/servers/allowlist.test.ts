import { describe, expect, it } from 'bun:test'
import { APP_CALL_METHODS, type FetchLike, createApiClient } from '@raven/core'

import { allowlistedFetch } from '@/servers/allowlist'

const ORIGIN = 'http://nas.local:8484'

/** A server that answers every request with no content, keeping each address it was asked for. */
const answering = () => {
  const asked: string[] = []
  const fetch: FetchLike = async (url, init = {}) => {
    asked.push(`${init.method ?? APP_CALL_METHODS.get} ${url}`)
    return {
      ok: true,
      status: 204,
      statusText: 'No Content',
      json: async () => null,
      text: async () => '',
    }
  }
  return { asked, fetch }
}

describe('allowlistedFetch', () => {
  it('sends a listed call on to the server', async () => {
    const { asked, fetch } = answering()
    const api = createApiClient({ baseUrl: ORIGIN, fetch: allowlistedFetch({ fetch }) })
    await api.recordPlay(3)
    await api.saveProgress({ id: 3, position: 40, audio: null })
    expect(asked).toEqual([
      `${APP_CALL_METHODS.post} ${ORIGIN}/api/media/3/plays`,
      `${APP_CALL_METHODS.put} ${ORIGIN}/api/media/3/progress`,
    ])
  })

  it('throws on a call the app may not make, before the server hears of it', async () => {
    const { asked, fetch } = answering()
    const api = createApiClient({ baseUrl: ORIGIN, fetch: allowlistedFetch({ fetch }) })
    await expect(api.deleteMedia(3)).rejects.toThrow(
      "raven's app does not call DELETE http://nas.local:8484/api/media/3",
    )
    await expect(api.scanLibrary(1)).rejects.toThrow(
      'POST http://nas.local:8484/api/libraries/1/scan',
    )
    await expect(api.browse('/volume1')).rejects.toThrow('GET http://nas.local:8484/api/fs/browse')
    await expect(api.lockAdmin()).rejects.toThrow('POST http://nas.local:8484/api/admin/lock')
    expect(asked).toEqual([])
  })

  it('throws on a listed path asked for with the wrong method', async () => {
    const { asked, fetch } = answering()
    await expect(
      allowlistedFetch({ fetch })(`${ORIGIN}/api/home`, { method: APP_CALL_METHODS.post }),
    ).rejects.toThrow("raven's app does not call POST")
    expect(asked).toEqual([])
  })

  it('leaves a ticket out of what it throws', async () => {
    const { fetch } = answering()
    await expect(
      allowlistedFetch({ fetch })(`${ORIGIN}/api/media/3/location?t=secret`),
    ).rejects.toThrow(
      /^raven's app does not call GET http:\/\/nas\.local:8484\/api\/media\/3\/location$/u,
    )
  })
})
