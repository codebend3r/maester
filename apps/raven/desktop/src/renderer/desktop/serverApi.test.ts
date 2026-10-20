import { describe, expect, it } from 'bun:test'
import { isLockedError } from '@raven/core'
import { ServerUnreachable, bridgedFetch, serverApiFor } from '@/renderer/desktop/serverApi'
import { fakeClient } from '@/renderer/test/render'
import { reply, S, serverClient } from '@/renderer/test/serverFakes'
import { mediaItemFor } from '@/shared/test/mediaItem'

const EPISODE = mediaItemFor({})

const rejectionOf = async (promise: Promise<unknown>): Promise<unknown> => {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error('the call resolved')
}

describe('serverApiFor', () => {
  it('sends a title read as a server call by path and resolves the title', async () => {
    const client = serverClient({ calls: { 'GET /api/media/7': reply({ body: EPISODE }) } })
    const api = serverApiFor({ client, serverId: S })
    expect(await api.getMedia(7)).toEqual(EPISODE)
    expect(client.request).toHaveBeenCalledWith({
      type: 'serverCall',
      serverId: S,
      method: 'GET',
      path: '/api/media/7',
      body: null,
    })
  })

  it('sends a saved position as a PUT with its JSON body', async () => {
    const client = serverClient({
      calls: { 'PUT /api/media/7/progress': reply({ status: 204, body: '' }) },
    })
    await serverApiFor({ client, serverId: S }).saveProgress({ id: 7, position: 40, audio: null })
    expect(client.request).toHaveBeenCalledWith({
      type: 'serverCall',
      serverId: S,
      method: 'PUT',
      path: '/api/media/7/progress',
      body: '{"position":40,"audio":null}',
    })
  })

  it('rejects a locked title with an error the lock check knows', async () => {
    const client = serverClient({
      calls: { 'GET /api/media/7': reply({ status: 423, body: { message: 'Locked.' } }) },
    })
    const error = await rejectionOf(serverApiFor({ client, serverId: S }).getMedia(7))
    expect(isLockedError(error)).toBe(true)
  })

  it('rejects a page that is not JSON as a reply it does not understand', async () => {
    const client = serverClient({ calls: { 'GET /api/media/7': reply({ body: '<html>' }) } })
    const error = await rejectionOf(serverApiFor({ client, serverId: S }).getMedia(7))
    expect(error).toBeInstanceOf(Error)
    expect(error instanceof Error ? error.message : '').toBe(
      'The server sent a response this client does not understand.',
    )
  })

  it('rejects with the words of main when the server cannot be reached', async () => {
    const client = fakeClient({
      request: async () => ({
        type: 'serverUnreachable',
        message: 'raven player could not reach raven.example.',
      }),
    })
    const error = await rejectionOf(serverApiFor({ client, serverId: S }).getMedia(7))
    expect(error).toBeInstanceOf(ServerUnreachable)
    expect(error instanceof Error ? error.message : '').toBe(
      'raven player could not reach raven.example.',
    )
  })

  it('rejects a refusal with its message, and a reply it cannot read with its own', async () => {
    const refusing = fakeClient({
      request: async () => ({
        type: 'refused',
        message: 'That server is no longer in raven player.',
      }),
    })
    const refused = await rejectionOf(serverApiFor({ client: refusing, serverId: S }).getMedia(7))
    expect(refused).toBeInstanceOf(ServerUnreachable)
    expect(refused instanceof Error ? refused.message : '').toBe(
      'That server is no longer in raven player.',
    )
    const odd = fakeClient({ request: async () => ({ type: 'done' }) })
    const unread = await rejectionOf(serverApiFor({ client: odd, serverId: S }).getMedia(7))
    expect(unread).toBeInstanceOf(ServerUnreachable)
    expect(unread instanceof Error ? unread.message : '').toBe(
      'raven player could not read its own reply.',
    )
  })

  it.each(['api/media/7', 'https://evil.example/api/media/7', '//evil.example/api/media/7', ''])(
    'throws the path %p, which does not start with one slash, before asking main',
    async (path) => {
      const client = serverClient({ calls: {} })
      const error = await rejectionOf(
        bridgedFetch({ client, serverId: S })(path, { method: 'GET' }),
      )
      expect(error).toBeInstanceOf(ServerUnreachable)
      expect(error instanceof Error ? error.message : '').toBe(
        'raven player does not make that call.',
      )
      expect(client.request).not.toHaveBeenCalled()
    },
  )

  it('throws a call with a method it never makes before asking main', async () => {
    const client = serverClient({ calls: {} })
    const error = await rejectionOf(serverApiFor({ client, serverId: S }).deleteLibrary(1))
    expect(error).toBeInstanceOf(ServerUnreachable)
    expect(error instanceof Error ? error.message : '').toBe(
      'raven player does not make that call.',
    )
    expect(client.request).not.toHaveBeenCalled()
  })
})
