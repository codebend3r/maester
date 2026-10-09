import { describe, expect, it } from 'vitest'
import { ApiError, type FetchInit, type FetchResponse, createApiClient } from '@/apiClient'
import { mediaItem } from '@/test/fixtures'

type Call = { url: string; init?: FetchInit }

const respond = ({ status = 200, body }: { status?: number; body?: unknown }): FetchResponse => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: status === 200 ? 'OK' : 'Error',
  json: async () => body,
})

const clientReturning = (response: FetchResponse) => {
  const calls: Call[] = []
  const client = createApiClient({
    baseUrl: 'http://nas:8484/',
    fetch: async (url, init) => {
      calls.push({ url, init })
      return response
    },
  })
  return { client, calls }
}

describe('createApiClient', () => {
  it('returns media that passes the guard', async () => {
    const item = mediaItem()
    const { client, calls } = clientReturning(respond({ body: [item] }))
    await expect(client.listMedia({ libraryId: 3, search: ' matrix ' })).resolves.toEqual([item])
    expect(calls[0]?.url).toBe('http://nas:8484/api/libraries/3/media?sort=title&q=matrix')
  })

  it('sends JSON bodies', async () => {
    const { client, calls } = clientReturning(respond({ status: 204 }))
    await client.saveProgress({ id: 7, position: 93.5 })
    expect(calls[0]?.init).toMatchObject({
      method: 'PUT',
      body: '{"position":93.5}',
      headers: { 'content-type': 'application/json' },
    })
  })

  it('surfaces the server error message', async () => {
    const { client } = clientReturning(
      respond({ status: 400, body: { statusCode: 400, message: ['Add at least one folder.'] } }),
    )
    await expect(client.createLibrary({ name: 'x', paths: [] })).rejects.toThrow(
      new ApiError({ status: 400, message: 'Add at least one folder.' }),
    )
  })

  it('rejects a response that does not match the contract', async () => {
    const { client } = clientReturning(respond({ body: [{ id: 'nope' }] }))
    await expect(client.listLibraries()).rejects.toBeInstanceOf(ApiError)
  })

  it('only hands out a thumbnail URL once one exists', () => {
    const { client } = clientReturning(respond({}))
    expect(client.thumbnailUrl(mediaItem({ id: 4, thumbnailVersion: 99 }))).toBe(
      'http://nas:8484/api/media/4/thumbnail?v=99',
    )
    expect(client.thumbnailUrl(mediaItem({ thumbnail: 'pending' }))).toBeNull()
  })

  it('points a player at the original file', () => {
    const { client } = clientReturning(respond({}))
    expect(client.fileUrl(5)).toBe('http://nas:8484/api/media/5/file')
  })

  it('marks a favourite and returns the updated item', async () => {
    const item = mediaItem({ id: 4, favourite: true })
    const { client, calls } = clientReturning(respond({ body: item }))
    await expect(client.setFavourite({ id: 4, favourite: true })).resolves.toEqual(item)
    expect(calls[0]?.url).toBe('http://nas:8484/api/media/4/favourite')
    expect(calls[0]?.init).toMatchObject({ method: 'PUT', body: '{"favourite":true}' })
  })

  it('lists favourites across every library', async () => {
    const item = mediaItem({ favourite: true })
    const { client, calls } = clientReturning(respond({ body: [item] }))
    await expect(client.listFavourites()).resolves.toEqual([item])
    expect(calls[0]?.url).toBe('http://nas:8484/api/favourites')
  })

  it('deletes a video', async () => {
    const { client, calls } = clientReturning(respond({ status: 204 }))
    await client.deleteMedia(9)
    expect(calls[0]).toMatchObject({
      url: 'http://nas:8484/api/media/9',
      init: { method: 'DELETE' },
    })
  })
})
