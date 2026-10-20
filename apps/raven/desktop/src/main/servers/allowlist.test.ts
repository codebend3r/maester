import { describe, expect, it } from 'bun:test'
import { HTTP_METHODS, MAX_SECRET, SERVER_METHODS } from '@/shared/protocol'
import {
  CALL_NAMES,
  MAX_BODY,
  isPageCall,
  isWrite,
  matchCall,
  requestFor,
  type AllowedCall,
  type ServerMethod,
} from '@/main/servers/allowlist'

type Accepted = {
  method: ServerMethod
  path: string
  body: string | null
  call: AllowedCall
  sentBody: string | null
}

const ACCEPTED: readonly Accepted[] = [
  {
    method: HTTP_METHODS.get,
    path: '/api/media/7',
    body: null,
    call: { name: CALL_NAMES.getMedia, mediaId: 7 },
    sentBody: null,
  },
  {
    method: HTTP_METHODS.get,
    path: '/api/media/7/tracks',
    body: null,
    call: { name: CALL_NAMES.getTracks, mediaId: 7 },
    sentBody: null,
  },
  {
    method: HTTP_METHODS.put,
    path: '/api/media/7/progress',
    body: '{"position":40}',
    call: { name: CALL_NAMES.saveProgress, mediaId: 7, position: 40 },
    sentBody: '{"position":40}',
  },
  {
    method: HTTP_METHODS.post,
    path: '/api/media/7/plays',
    body: null,
    call: { name: CALL_NAMES.recordPlay, mediaId: 7 },
    sentBody: null,
  },
  {
    method: HTTP_METHODS.get,
    path: '/api/lock',
    body: null,
    call: { name: CALL_NAMES.getLock },
    sentBody: null,
  },
  {
    method: HTTP_METHODS.post,
    path: '/api/lock/unlock',
    body: '{"pin":"1234"}',
    call: { name: CALL_NAMES.unlock, pin: '1234' },
    sentBody: '{"pin":"1234"}',
  },
  {
    method: HTTP_METHODS.get,
    path: '/api/admin',
    body: null,
    call: { name: CALL_NAMES.getAdminLock },
    sentBody: null,
  },
  {
    method: HTTP_METHODS.post,
    path: '/api/admin/unlock',
    body: '{"password":"hunter2"}',
    call: { name: CALL_NAMES.unlockAdmin, password: 'hunter2' },
    sentBody: '{"password":"hunter2"}',
  },
  {
    method: HTTP_METHODS.get,
    path: '/api/items/10',
    body: null,
    call: { name: CALL_NAMES.getItem, itemId: 10 },
    sentBody: null,
  },
  {
    method: HTTP_METHODS.get,
    path: '/api/libraries/3',
    body: null,
    call: { name: CALL_NAMES.getLibrary, libraryId: 3 },
    sentBody: null,
  },
  {
    method: HTTP_METHODS.get,
    path: '/api/libraries/3/sagas',
    body: null,
    call: { name: CALL_NAMES.getSagas, libraryId: 3 },
    sentBody: null,
  },
  {
    method: HTTP_METHODS.get,
    path: '/api/media-origins',
    body: null,
    call: { name: CALL_NAMES.getMediaOrigins },
    sentBody: null,
  },
  {
    method: HTTP_METHODS.get,
    path: '/api/media/7/ticket',
    body: null,
    call: { name: CALL_NAMES.getMediaTicket, mediaId: 7 },
    sentBody: null,
  },
  {
    method: HTTP_METHODS.get,
    path: '/api/auth/config',
    body: null,
    call: { name: CALL_NAMES.getAuthConfig },
    sentBody: null,
  },
  {
    method: HTTP_METHODS.get,
    path: '/api/me',
    body: null,
    call: { name: CALL_NAMES.getMe },
    sentBody: null,
  },
  {
    method: HTTP_METHODS.post,
    path: '/api/auth/media/7/ticket',
    body: null,
    call: { name: CALL_NAMES.getAccountTicket, mediaId: 7 },
    sentBody: null,
  },
]

const CASES = ACCEPTED.map((entry) => [entry.call.name, entry] as const)

const refuse = ({
  method,
  path,
  body = null,
}: {
  method: string
  path: string
  body?: string | null
}): void => {
  expect(matchCall({ method, path, body })).toBeNull()
}

describe('the allowlist values', () => {
  it('names three methods and the two limits', () => {
    expect(Object.values(SERVER_METHODS)).toEqual([
      SERVER_METHODS.get,
      SERVER_METHODS.put,
      SERVER_METHODS.post,
    ])
    expect(MAX_BODY).toBe(4096)
    expect(MAX_SECRET).toBe(256)
  })
})

describe('matchCall accepts exactly the sixteen calls', () => {
  it.each(CASES)('accepts %s', (_name, { method, path, body, call }) => {
    expect(matchCall({ method, path, body })).toEqual(call)
  })

  it('accepts the largest safe media id', () => {
    expect(
      matchCall({ method: HTTP_METHODS.get, path: '/api/media/9007199254740991', body: null }),
    ).toEqual({
      name: CALL_NAMES.getMedia,
      mediaId: 9007199254740991,
    })
  })

  it('accepts a position of 0 and a fractional one', () => {
    expect(
      matchCall({
        method: HTTP_METHODS.put,
        path: '/api/media/1/progress',
        body: '{"position":0}',
      }),
    ).toEqual({ name: CALL_NAMES.saveProgress, mediaId: 1, position: 0 })
    expect(
      matchCall({
        method: HTTP_METHODS.put,
        path: '/api/media/1/progress',
        body: '{"position":12.5}',
      }),
    ).toEqual({ name: CALL_NAMES.saveProgress, mediaId: 1, position: 12.5 })
  })

  it('accepts a body of exactly MAX_BODY characters', () => {
    const body = `{"position":40${' '.repeat(MAX_BODY - '{"position":40}'.length)}}`
    expect(body.length).toBe(MAX_BODY)
    expect(matchCall({ method: HTTP_METHODS.put, path: '/api/media/1/progress', body })).toEqual({
      name: CALL_NAMES.saveProgress,
      mediaId: 1,
      position: 40,
    })
  })

  it('accepts a PIN and a password of exactly MAX_SECRET characters', () => {
    const secret = 'a'.repeat(MAX_SECRET)
    expect(
      matchCall({
        method: HTTP_METHODS.post,
        path: '/api/lock/unlock',
        body: JSON.stringify({ pin: secret }),
      }),
    ).toEqual({ name: CALL_NAMES.unlock, pin: secret })
    expect(
      matchCall({
        method: HTTP_METHODS.post,
        path: '/api/admin/unlock',
        body: JSON.stringify({ password: secret }),
      }),
    ).toEqual({ name: CALL_NAMES.unlockAdmin, password: secret })
  })
})

describe('requestFor', () => {
  it.each(CASES)('builds the request for %s', (_name, { method, path, call, sentBody }) => {
    expect(requestFor(call)).toEqual({ method, path, body: sentBody })
  })

  it('sends only the known field of a body, never what the page sent', () => {
    const call = matchCall({
      method: HTTP_METHODS.put,
      path: '/api/media/7/progress',
      body: '{"position":40,"extra":"x"}',
    })
    expect(call).not.toBeNull()
    expect(requestFor(call!).body).toBe('{"position":40}')
  })

  it('drops extra fields from an unlock body too', () => {
    const unlock = matchCall({
      method: HTTP_METHODS.post,
      path: '/api/lock/unlock',
      body: '{"pin":"1","admin":true}',
    })
    expect(requestFor(unlock!).body).toBe('{"pin":"1"}')
    const admin = matchCall({
      method: HTTP_METHODS.post,
      path: '/api/admin/unlock',
      body: '{"password":"p","pin":"1"}',
    })
    expect(requestFor(admin!).body).toBe('{"password":"p"}')
  })

  it('escapes control characters in a secret when it serializes it', () => {
    const call = matchCall({
      method: HTTP_METHODS.post,
      path: '/api/lock/unlock',
      body: '{"pin":"1\\r\\n2"}',
    })
    expect(requestFor(call!).body).toBe('{"pin":"1\\r\\n2"}')
  })
})

describe('isWrite', () => {
  it('is true for saveProgress and recordPlay only, so the five new reads are not writes', () => {
    expect(ACCEPTED.filter(({ call }) => isWrite(call)).map(({ call }) => call.name)).toEqual([
      CALL_NAMES.saveProgress,
      CALL_NAMES.recordPlay,
    ])
  })
})

describe('isPageCall', () => {
  it('keeps the origin list, tickets and the account calls to main, and lets the page make the rest', () => {
    expect(ACCEPTED.filter(({ call }) => !isPageCall(call)).map(({ call }) => call.name)).toEqual([
      CALL_NAMES.getMediaOrigins,
      CALL_NAMES.getMediaTicket,
      CALL_NAMES.getAuthConfig,
      CALL_NAMES.getMe,
      CALL_NAMES.getAccountTicket,
    ])
  })
})

describe('matchCall refuses calls off the list', () => {
  it('refuses GET /api/media/1/location', () =>
    refuse({ method: HTTP_METHODS.get, path: '/api/media/1/location' }))
  it('refuses GET /api/media/1/file', () =>
    refuse({ method: HTTP_METHODS.get, path: '/api/media/1/file' }))
  it('refuses GET /api/media/1/subtitles/external-0', () =>
    refuse({ method: HTTP_METHODS.get, path: '/api/media/1/subtitles/external-0' }))
  it('refuses GET /api/media/1/stream', () =>
    refuse({ method: HTTP_METHODS.get, path: '/api/media/1/stream' }))
  it('refuses DELETE /api/media/1', () =>
    refuse({ method: HTTP_METHODS.delete, path: '/api/media/1' }))
  it('refuses GET /api/libraries', () =>
    refuse({ method: HTTP_METHODS.get, path: '/api/libraries' }))
  it('refuses POST /api/lock/lock', () =>
    refuse({ method: HTTP_METHODS.post, path: '/api/lock/lock' }))
  it('refuses POST /api/admin/lock', () =>
    refuse({ method: HTTP_METHODS.post, path: '/api/admin/lock' }))
  it('refuses POST /api/admin/keep-unlocked', () =>
    refuse({ method: HTTP_METHODS.post, path: '/api/admin/keep-unlocked' }))
  it('refuses PUT /api/media/1/favourite', () =>
    refuse({
      method: HTTP_METHODS.put,
      path: '/api/media/1/favourite',
      body: '{"favourite":true}',
    }))
  it('refuses a near miss of a known path', () => {
    refuse({ method: HTTP_METHODS.put, path: '/api/media/1/progresss', body: '{"position":1}' })
    refuse({ method: HTTP_METHODS.put, path: '/api/media/1/progres', body: '{"position":1}' })
    refuse({ method: HTTP_METHODS.get, path: '/api/media/1/trackss' })
    refuse({ method: HTTP_METHODS.get, path: '/api/locks' })
    refuse({ method: HTTP_METHODS.get, path: '/api/administrator' })
    refuse({ method: HTTP_METHODS.get, path: '/api/media' })
    refuse({ method: HTTP_METHODS.get, path: '/api/media/' })
  })
})

describe('matchCall refuses the new reads when they are not exact', () => {
  it('refuses a trailing slash, a leading zero and a query', () => {
    refuse({ method: HTTP_METHODS.get, path: '/api/items/10/' })
    refuse({ method: HTTP_METHODS.get, path: '/api/items/010' })
    refuse({ method: HTTP_METHODS.get, path: '/api/libraries/03/sagas' })
    refuse({ method: HTTP_METHODS.get, path: '/api/libraries/3/sagas/' })
    refuse({ method: HTTP_METHODS.get, path: '/api/media/7/ticket?x=1' })
    refuse({ method: HTTP_METHODS.get, path: '/api/media-origins/ping' })
    refuse({ method: HTTP_METHODS.get, path: '/api/media-origins?x=1' })
  })

  it('refuses a write method on any of the five', () => {
    refuse({ method: HTTP_METHODS.post, path: '/api/items/10' })
    refuse({ method: HTTP_METHODS.put, path: '/api/libraries/3' })
    refuse({ method: HTTP_METHODS.post, path: '/api/libraries/3/sagas' })
    refuse({ method: HTTP_METHODS.post, path: '/api/media-origins' })
    refuse({ method: HTTP_METHODS.post, path: '/api/media/7/ticket' })
  })

  it('refuses a body on any of the five', () => {
    refuse({ method: HTTP_METHODS.get, path: '/api/items/10', body: '{}' })
    refuse({ method: HTTP_METHODS.get, path: '/api/libraries/3', body: '{}' })
    refuse({ method: HTTP_METHODS.get, path: '/api/libraries/3/sagas', body: '{}' })
    refuse({ method: HTTP_METHODS.get, path: '/api/media-origins', body: '{}' })
    refuse({ method: HTTP_METHODS.get, path: '/api/media/7/ticket', body: '{}' })
  })

  it('refuses an id past the safe integers', () => {
    refuse({ method: HTTP_METHODS.get, path: '/api/items/9007199254740992' })
    refuse({ method: HTTP_METHODS.get, path: '/api/libraries/9007199254740992' })
  })
})

describe('matchCall refuses the account calls when they are not exact', () => {
  it('refuses a body on any of the three', () => {
    refuse({ method: HTTP_METHODS.get, path: '/api/auth/config', body: '{}' })
    refuse({ method: HTTP_METHODS.get, path: '/api/me', body: '{}' })
    refuse({ method: HTTP_METHODS.post, path: '/api/auth/media/7/ticket', body: '{}' })
    refuse({ method: HTTP_METHODS.post, path: '/api/auth/media/7/ticket', body: '' })
  })

  it('refuses a query, a trailing or extra slash and a hash', () => {
    refuse({ method: HTTP_METHODS.get, path: '/api/auth/config?x=1' })
    refuse({ method: HTTP_METHODS.get, path: '/api/auth/config/' })
    refuse({ method: HTTP_METHODS.get, path: '/api/me?x=1' })
    refuse({ method: HTTP_METHODS.get, path: '/api/me/' })
    refuse({ method: HTTP_METHODS.get, path: '/api//me' })
    refuse({ method: HTTP_METHODS.post, path: '/api/auth/media/7/ticket?x=1' })
    refuse({ method: HTTP_METHODS.post, path: '/api/auth/media/7/ticket/' })
    refuse({ method: HTTP_METHODS.post, path: '/api/auth/media//7/ticket' })
    refuse({ method: HTTP_METHODS.post, path: '/api/auth//media/7/ticket' })
    refuse({ method: HTTP_METHODS.post, path: '/api/auth/media/7/ticket#x' })
  })

  it('refuses a ticket for an id that is 0, padded, signed or not a number', () => {
    refuse({ method: HTTP_METHODS.post, path: '/api/auth/media/0/ticket' })
    refuse({ method: HTTP_METHODS.post, path: '/api/auth/media/07/ticket' })
    refuse({ method: HTTP_METHODS.post, path: '/api/auth/media/-7/ticket' })
    refuse({ method: HTTP_METHODS.post, path: '/api/auth/media/1.5/ticket' })
    refuse({ method: HTTP_METHODS.post, path: '/api/auth/media/:id/ticket' })
    refuse({ method: HTTP_METHODS.post, path: '/api/auth/media/9007199254740992/ticket' })
  })

  it('refuses the wrong method on each', () => {
    refuse({ method: HTTP_METHODS.post, path: '/api/auth/config' })
    refuse({ method: HTTP_METHODS.post, path: '/api/me' })
    refuse({ method: HTTP_METHODS.get, path: '/api/auth/media/7/ticket' })
    refuse({ method: HTTP_METHODS.put, path: '/api/auth/media/7/ticket' })
  })

  it('refuses the other account routes', () => {
    refuse({ method: HTTP_METHODS.get, path: '/api/auth/members' })
    refuse({
      method: HTTP_METHODS.put,
      path: '/api/auth/members/1/status',
      body: '{"status":"approved"}',
    })
  })
})

describe('matchCall refuses odd ids', () => {
  it('refuses GET /api/media/0', () => refuse({ method: HTTP_METHODS.get, path: '/api/media/0' }))
  it('refuses GET /api/media/01', () => refuse({ method: HTTP_METHODS.get, path: '/api/media/01' }))
  it('refuses a negative, signed, fractional or exponent id', () => {
    refuse({ method: HTTP_METHODS.get, path: '/api/media/-1' })
    refuse({ method: HTTP_METHODS.get, path: '/api/media/+1' })
    refuse({ method: HTTP_METHODS.get, path: '/api/media/1.5' })
    refuse({ method: HTTP_METHODS.get, path: '/api/media/1e3' })
    refuse({ method: HTTP_METHODS.get, path: '/api/media/0x10' })
  })
  it('refuses an id past the safe integers', () => {
    refuse({ method: HTTP_METHODS.get, path: '/api/media/9007199254740992' })
    refuse({ method: HTTP_METHODS.get, path: '/api/media/9007199254740993' })
    refuse({ method: HTTP_METHODS.get, path: '/api/media/99999999999999999' })
  })
  it('refuses an id in other digits', () =>
    refuse({ method: HTTP_METHODS.get, path: '/api/media/\u0661' }))
})

describe('matchCall refuses paths that are not exact', () => {
  it('refuses GET /api/media/1?x=1', () =>
    refuse({ method: HTTP_METHODS.get, path: '/api/media/1?x=1' }))
  it('refuses a bare question mark', () => refuse({ method: HTTP_METHODS.get, path: '/api/lock?' }))
  it('refuses GET /api/media/1/', () => refuse({ method: HTTP_METHODS.get, path: '/api/media/1/' }))
  it('refuses GET /api/media/1#x', () =>
    refuse({ method: HTTP_METHODS.get, path: '/api/media/1#x' }))
  it('refuses GET /api/media/../admin', () =>
    refuse({ method: HTTP_METHODS.get, path: '/api/media/../admin' }))
  it('refuses a path that walks back out of a known one', () => {
    refuse({ method: HTTP_METHODS.get, path: '/api/media/1/../../admin' })
    refuse({ method: HTTP_METHODS.get, path: '/api/media/1/./tracks' })
    refuse({ method: HTTP_METHODS.get, path: '/api/media/1/%2e%2e/%2e%2e/admin' })
    refuse({ method: HTTP_METHODS.get, path: '/api/media/1%2Ftracks' })
    refuse({ method: HTTP_METHODS.get, path: '/api%2Flock' })
    refuse({ method: HTTP_METHODS.get, path: '/api/l%6Fck' })
  })
  it('refuses doubled slashes and backslashes', () => {
    refuse({ method: HTTP_METHODS.get, path: '//api/lock' })
    refuse({ method: HTTP_METHODS.get, path: '/api//lock' })
    refuse({ method: HTTP_METHODS.get, path: '\\api\\lock' })
    refuse({ method: HTTP_METHODS.get, path: '/api\\lock' })
  })
  it('refuses GET //evil.example/api/lock', () =>
    refuse({ method: HTTP_METHODS.get, path: '//evil.example/api/lock' }))
  it('refuses GET https://evil.example/api/lock', () =>
    refuse({ method: HTTP_METHODS.get, path: 'https://evil.example/api/lock' }))
  it('refuses a path with no leading slash', () =>
    refuse({ method: HTTP_METHODS.get, path: 'api/lock' }))
  it('refuses a path with a line break, a NUL or spaces around it', () => {
    refuse({ method: HTTP_METHODS.get, path: '/api/lock\n' })
    refuse({ method: HTTP_METHODS.get, path: '/api/lock\r\nX-Evil: 1' })
    refuse({ method: HTTP_METHODS.get, path: '/api/lock\u0000' })
    refuse({ method: HTTP_METHODS.get, path: ' /api/lock' })
    refuse({ method: HTTP_METHODS.get, path: '/api/lock ' })
    refuse({ method: HTTP_METHODS.get, path: '/api/media/1\n/tracks' })
  })
  it('refuses a path in other cases', () => {
    refuse({ method: HTTP_METHODS.get, path: '/API/lock' })
    refuse({ method: HTTP_METHODS.get, path: '/api/Lock' })
  })
  it('refuses an empty path', () => refuse({ method: HTTP_METHODS.get, path: '' }))
})

describe('matchCall refuses the wrong method', () => {
  it('refuses get /api/lock', () => refuse({ method: 'get', path: '/api/lock' }))
  it('refuses a method with spaces or a line break', () => {
    refuse({ method: ' GET', path: '/api/lock' })
    refuse({ method: 'GET\r\n', path: '/api/lock' })
  })
  it('refuses PUT where GET is allowed', () =>
    refuse({ method: HTTP_METHODS.put, path: '/api/media/1' }))
  it('refuses POST where GET is allowed', () =>
    refuse({ method: HTTP_METHODS.post, path: '/api/lock' }))
  it('refuses GET where PUT is allowed', () =>
    refuse({ method: HTTP_METHODS.get, path: '/api/media/1/progress' }))
  it('refuses PUT where POST is allowed', () =>
    refuse({ method: HTTP_METHODS.put, path: '/api/lock/unlock', body: '{"pin":"1"}' }))
  it('refuses HEAD, OPTIONS and PATCH', () => {
    refuse({ method: HTTP_METHODS.head, path: '/api/lock' })
    refuse({ method: 'OPTIONS', path: '/api/lock' })
    refuse({ method: 'PATCH', path: '/api/media/1/progress', body: '{"position":1}' })
  })
})

describe('matchCall refuses bodies that do not fit the call', () => {
  it('refuses GET /api/lock with a body', () =>
    refuse({ method: HTTP_METHODS.get, path: '/api/lock', body: '{}' }))
  it('refuses an empty body where none is taken', () =>
    refuse({ method: HTTP_METHODS.get, path: '/api/media/1', body: '' }))
  it('refuses POST /api/media/1/plays with a body', () =>
    refuse({ method: HTTP_METHODS.post, path: '/api/media/1/plays', body: '{}' }))
  it('refuses PUT .../progress with {"position":"x"}', () =>
    refuse({ method: HTTP_METHODS.put, path: '/api/media/1/progress', body: '{"position":"x"}' }))
  it('refuses PUT .../progress with no body', () =>
    refuse({ method: HTTP_METHODS.put, path: '/api/media/1/progress' }))
  it('refuses PUT .../progress with 5,000 characters', () => {
    const body = `{"position":40${' '.repeat(5000)}}`
    expect(body.length).toBeGreaterThan(MAX_BODY)
    refuse({ method: HTTP_METHODS.put, path: '/api/media/1/progress', body })
  })
  it('refuses a body one character past MAX_BODY', () => {
    const body = `{"position":40${' '.repeat(MAX_BODY - '{"position":40}'.length + 1)}}`
    refuse({ method: HTTP_METHODS.put, path: '/api/media/1/progress', body })
  })
  it('refuses a negative position', () =>
    refuse({ method: HTTP_METHODS.put, path: '/api/media/1/progress', body: '{"position":-1}' }))
  it('refuses a body that is not JSON', () => {
    refuse({ method: HTTP_METHODS.put, path: '/api/media/1/progress', body: 'position=40' })
    refuse({ method: HTTP_METHODS.put, path: '/api/media/1/progress', body: '{"position":40' })
    refuse({ method: HTTP_METHODS.put, path: '/api/media/1/progress', body: '' })
  })
  it('refuses a JSON body that is not an object', () => {
    refuse({ method: HTTP_METHODS.put, path: '/api/media/1/progress', body: '40' })
    refuse({ method: HTTP_METHODS.put, path: '/api/media/1/progress', body: '[40]' })
    refuse({ method: HTTP_METHODS.put, path: '/api/media/1/progress', body: 'null' })
  })
  it('refuses a position hidden behind __proto__', () =>
    refuse({
      method: HTTP_METHODS.put,
      path: '/api/media/1/progress',
      body: '{"__proto__":{"position":1}}',
    }))
  it('refuses POST /api/lock/unlock with a 300-character PIN', () =>
    refuse({
      method: HTTP_METHODS.post,
      path: '/api/lock/unlock',
      body: JSON.stringify({ pin: 'a'.repeat(300) }),
    }))
  it('refuses a PIN one past MAX_SECRET and a password one past it', () => {
    refuse({
      method: HTTP_METHODS.post,
      path: '/api/lock/unlock',
      body: JSON.stringify({ pin: 'a'.repeat(MAX_SECRET + 1) }),
    })
    refuse({
      method: HTTP_METHODS.post,
      path: '/api/admin/unlock',
      body: JSON.stringify({ password: 'a'.repeat(MAX_SECRET + 1) }),
    })
  })
  it('refuses a PIN that is not a string', () => {
    refuse({ method: HTTP_METHODS.post, path: '/api/lock/unlock', body: '{"pin":1234}' })
    refuse({ method: HTTP_METHODS.post, path: '/api/lock/unlock', body: '{}' })
    refuse({ method: HTTP_METHODS.post, path: '/api/lock/unlock' })
  })
  it('refuses a password in the PIN call and a PIN in the password call', () => {
    refuse({ method: HTTP_METHODS.post, path: '/api/lock/unlock', body: '{"password":"p"}' })
    refuse({ method: HTTP_METHODS.post, path: '/api/admin/unlock', body: '{"pin":"1"}' })
  })
})
