import { describe, expect, it } from 'bun:test'
import { APP_CALL_METHODS, APP_CLIENT_CALLS, appClientCallOf } from '@/appClientCalls'

const { get, put, post } = APP_CALL_METHODS

/** A method the server takes that the app never sends. */
const UNSENT_METHODS = { delete: 'DELETE' } as const

const callOf = ({ method, url }: { method: string; url: string }) => {
  const name = appClientCallOf({ method, url })
  return name === null ? null : APP_CLIENT_CALLS[name]
}

describe('appClientCallOf', () => {
  it('reads a listed call from a whole address, its query and fragment aside', () => {
    expect(callOf({ method: get, url: 'http://nas.local:8484/api/home' })).toBe(
      APP_CLIENT_CALLS.getHome,
    )
    expect(callOf({ method: get, url: 'https://raven.example/api/home/search?q=dune' })).toBe(
      APP_CLIENT_CALLS.searchHome,
    )
    expect(callOf({ method: put, url: 'http://nas:8484/api/media/12/progress' })).toBe(
      APP_CLIENT_CALLS.saveProgress,
    )
    expect(
      callOf({
        method: get,
        url: 'https://media.example/api/media/3/hls/s3ss10n/segment/41?t=x#end',
      }),
    ).toBe(APP_CLIENT_CALLS.hlsSegment)
  })

  it('reads a listed call from a bare path', () => {
    expect(callOf({ method: post, url: '/api/lock/unlock' })).toBe(APP_CLIENT_CALLS.unlock)
    expect(callOf({ method: get, url: '/api/media/9/subtitles/embedded-0' })).toBe(
      APP_CLIENT_CALLS.subtitles,
    )
  })

  it('allows capability pictures with their version in the path', () => {
    expect(callOf({ method: get, url: '/api/pictures/items/40/backdrop/b40' })).toBe(
      APP_CLIENT_CALLS.itemPicture,
    )
    expect(callOf({ method: get, url: '/api/pictures/people/4/p4' })).toBe(
      APP_CLIENT_CALLS.personPicture,
    )
    expect(callOf({ method: get, url: '/api/pictures/items/40/backdrop/' })).toBeNull()
    expect(callOf({ method: post, url: '/api/pictures/people/4/p4' })).toBeNull()
  })

  it('fills each placeholder with exactly one segment', () => {
    expect(callOf({ method: get, url: '/api/media/9/hls/s/subtitles/embedded-0/3' })).toBe(
      APP_CLIENT_CALLS.hlsSubtitleSegment,
    )
    expect(callOf({ method: get, url: '/api/items//images/poster' })).toBeNull()
    expect(callOf({ method: get, url: '/api/items/1/2/images/poster' })).toBeNull()
  })

  it("reads the accounts' calls: the config, the account and a title's account ticket", () => {
    expect(callOf({ method: get, url: 'http://nas:8484/api/auth/config' })).toBe(
      APP_CLIENT_CALLS.getAuthConfig,
    )
    expect(callOf({ method: get, url: '/api/me' })).toBe(APP_CLIENT_CALLS.getMe)
    expect(callOf({ method: post, url: '/api/auth/media/12/ticket' })).toBe(
      APP_CLIENT_CALLS.getAccountTicket,
    )
    expect(callOf({ method: get, url: '/api/auth/media/12/ticket' })).toBeNull()
    expect(callOf({ method: get, url: '/api/auth/members' })).toBeNull()
  })

  it('is no call when the method differs', () => {
    expect(callOf({ method: post, url: '/api/home' })).toBeNull()
    expect(callOf({ method: get, url: '/api/lock/unlock' })).toBeNull()
  })

  it('is no call for a route the app has no business with', () => {
    expect(callOf({ method: UNSENT_METHODS.delete, url: '/api/media/4' })).toBeNull()
    expect(callOf({ method: post, url: '/api/libraries/1/scan' })).toBeNull()
    expect(callOf({ method: get, url: '/api/fs/browse' })).toBeNull()
    expect(callOf({ method: get, url: '/api/lock/' })).toBeNull()
  })

  it('refuses a dot segment, written plain or escaped, wherever it is', () => {
    expect(callOf({ method: get, url: '/api/media/../lock' })).toBeNull()
    expect(callOf({ method: get, url: '/api/media/./tracks' })).toBeNull()
    expect(callOf({ method: get, url: '/api/media/%2E%2e' })).toBeNull()
    expect(callOf({ method: get, url: 'http://nas/api/items/../../api/admin' })).toBeNull()
  })

  it('refuses an address that is not a path or an absolute URL', () => {
    expect(callOf({ method: get, url: 'api/home' })).toBeNull()
    expect(callOf({ method: get, url: '' })).toBeNull()
  })

  it('names every call it lists', () => {
    expect(
      Object.entries(APP_CLIENT_CALLS).every(
        ([name, call]) =>
          appClientCallOf({ method: call.method, url: call.path.replaceAll(':', 'x') }) === name,
      ),
    ).toBe(true)
  })
})
