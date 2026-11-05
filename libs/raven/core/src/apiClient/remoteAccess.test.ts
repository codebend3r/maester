import { describe, expect, it } from 'bun:test'
import {
  DEFAULT_REMOTE_ACCESS_SETTINGS,
  type MediaOrigin,
  REMOTE_ACCESS_STATES,
  type RemotePlayback,
} from '@/contract'
import { clientReturning, respond } from '@/test/apiClientFakes'

describe('remote access calls', () => {
  it('reads remote access and sends a change, which the server checks again', async () => {
    const state = {
      settings: { ...DEFAULT_REMOTE_ACCESS_SETTINGS, isEnabled: true },
      privateAddress: null,
      publicOrigin: null,
      status: { state: REMOTE_ACCESS_STATES.unconfigured },
    }
    const { client, calls } = clientReturning(respond({ body: state }))
    await expect(client.getRemoteAccess()).resolves.toEqual(state)
    await expect(client.setRemoteAccess({ publicPort: 8443 })).resolves.toEqual(state)
    expect(calls.map((call) => [call.url, call.init?.method, call.init?.body])).toEqual([
      ['http://nas:8484/api/remote-access', 'GET', undefined],
      ['http://nas:8484/api/remote-access', 'PUT', JSON.stringify({ publicPort: 8443 })],
    ])
    const { client: broken } = clientReturning(respond({ body: { settings: {} } }))
    await expect(broken.getRemoteAccess()).rejects.toMatchObject({ status: 502 })
  })

  it('reads what the media origins say of remote play, and none from an older server as null', async () => {
    const origins: MediaOrigin[] = [{ kind: 'public', url: 'https://raven.example.com:8443' }]
    const remote: RemotePlayback = { limit: 'low720', isOutside: true }
    const { client } = clientReturning(respond({ body: { origins, remote } }))
    await expect(client.getMediaOrigins()).resolves.toEqual({ origins, remote })
    const { client: older } = clientReturning(respond({ body: { origins } }))
    await expect(older.getMediaOrigins()).resolves.toEqual({ origins, remote: null })
    const { client: broken } = clientReturning(
      respond({ body: { origins, remote: { limit: 'huge', isOutside: true } } }),
    )
    await expect(broken.getMediaOrigins()).rejects.toMatchObject({ status: 502 })
  })
})
