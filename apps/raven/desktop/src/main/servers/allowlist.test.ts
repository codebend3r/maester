import { describe, expect, it } from 'bun:test'
import { SERVER_METHODS } from '@/shared/protocol'
import {
  MAX_BODY,
  MAX_SECRET,
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
    method: 'GET',
    path: '/api/media/7',
    body: null,
    call: { name: 'getMedia', mediaId: 7 },
    sentBody: null,
  },
  {
    method: 'GET',
    path: '/api/media/7/tracks',
    body: null,
    call: { name: 'getTracks', mediaId: 7 },
    sentBody: null,
  },
  {
    method: 'PUT',
    path: '/api/media/7/progress',
    body: '{"position":40}',
    call: { name: 'saveProgress', mediaId: 7, position: 40 },
    sentBody: '{"position":40}',
  },
  {
    method: 'POST',
    path: '/api/media/7/plays',
    body: null,
    call: { name: 'recordPlay', mediaId: 7 },
    sentBody: null,
  },
  { method: 'GET', path: '/api/lock', body: null, call: { name: 'getLock' }, sentBody: null },
  {
    method: 'POST',
    path: '/api/lock/unlock',
    body: '{"pin":"1234"}',
    call: { name: 'unlock', pin: '1234' },
    sentBody: '{"pin":"1234"}',
  },
  { method: 'GET', path: '/api/admin', body: null, call: { name: 'getAdminLock' }, sentBody: null },
  {
    method: 'POST',
    path: '/api/admin/unlock',
    body: '{"password":"hunter2"}',
    call: { name: 'unlockAdmin', password: 'hunter2' },
    sentBody: '{"password":"hunter2"}',
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
    expect(Object.values(SERVER_METHODS)).toEqual(['GET', 'PUT', 'POST'])
    expect(MAX_BODY).toBe(4096)
    expect(MAX_SECRET).toBe(256)
  })
})

describe('matchCall accepts exactly the eight calls', () => {
  it.each(CASES)('accepts %s', (_name, { method, path, body, call }) => {
    expect(matchCall({ method, path, body })).toEqual(call)
  })

  it('accepts the largest safe media id', () => {
    expect(matchCall({ method: 'GET', path: '/api/media/9007199254740991', body: null })).toEqual({
      name: 'getMedia',
      mediaId: 9007199254740991,
    })
  })

  it('accepts a position of 0 and a fractional one', () => {
    expect(
      matchCall({ method: 'PUT', path: '/api/media/1/progress', body: '{"position":0}' }),
    ).toEqual({ name: 'saveProgress', mediaId: 1, position: 0 })
    expect(
      matchCall({ method: 'PUT', path: '/api/media/1/progress', body: '{"position":12.5}' }),
    ).toEqual({ name: 'saveProgress', mediaId: 1, position: 12.5 })
  })

  it('accepts a body of exactly MAX_BODY characters', () => {
    const body = `{"position":40${' '.repeat(MAX_BODY - '{"position":40}'.length)}}`
    expect(body.length).toBe(MAX_BODY)
    expect(matchCall({ method: 'PUT', path: '/api/media/1/progress', body })).toEqual({
      name: 'saveProgress',
      mediaId: 1,
      position: 40,
    })
  })

  it('accepts a PIN and a password of exactly MAX_SECRET characters', () => {
    const secret = 'a'.repeat(MAX_SECRET)
    expect(
      matchCall({
        method: 'POST',
        path: '/api/lock/unlock',
        body: JSON.stringify({ pin: secret }),
      }),
    ).toEqual({ name: 'unlock', pin: secret })
    expect(
      matchCall({
        method: 'POST',
        path: '/api/admin/unlock',
        body: JSON.stringify({ password: secret }),
      }),
    ).toEqual({ name: 'unlockAdmin', password: secret })
  })
})

describe('requestFor', () => {
  it.each(CASES)('builds the request for %s', (_name, { method, path, call, sentBody }) => {
    expect(requestFor(call)).toEqual({ method, path, body: sentBody })
  })

  it('sends only the known field of a body, never what the page sent', () => {
    const call = matchCall({
      method: 'PUT',
      path: '/api/media/7/progress',
      body: '{"position":40,"extra":"x"}',
    })
    expect(call).not.toBeNull()
    expect(requestFor(call!).body).toBe('{"position":40}')
  })

  it('drops extra fields from an unlock body too', () => {
    const unlock = matchCall({
      method: 'POST',
      path: '/api/lock/unlock',
      body: '{"pin":"1","admin":true}',
    })
    expect(requestFor(unlock!).body).toBe('{"pin":"1"}')
    const admin = matchCall({
      method: 'POST',
      path: '/api/admin/unlock',
      body: '{"password":"p","pin":"1"}',
    })
    expect(requestFor(admin!).body).toBe('{"password":"p"}')
  })

  it('escapes control characters in a secret when it serializes it', () => {
    const call = matchCall({ method: 'POST', path: '/api/lock/unlock', body: '{"pin":"1\\r\\n2"}' })
    expect(requestFor(call!).body).toBe('{"pin":"1\\r\\n2"}')
  })
})

describe('isWrite', () => {
  it('is true for saveProgress and recordPlay only', () => {
    expect(ACCEPTED.filter(({ call }) => isWrite(call)).map(({ call }) => call.name)).toEqual([
      'saveProgress',
      'recordPlay',
    ])
  })
})

describe('matchCall refuses calls off the list', () => {
  it('refuses GET /api/media/1/location', () =>
    refuse({ method: 'GET', path: '/api/media/1/location' }))
  it('refuses GET /api/media/1/file', () => refuse({ method: 'GET', path: '/api/media/1/file' }))
  it('refuses GET /api/media/1/subtitles/external-0', () =>
    refuse({ method: 'GET', path: '/api/media/1/subtitles/external-0' }))
  it('refuses GET /api/media/1/stream', () =>
    refuse({ method: 'GET', path: '/api/media/1/stream' }))
  it('refuses DELETE /api/media/1', () => refuse({ method: 'DELETE', path: '/api/media/1' }))
  it('refuses GET /api/libraries', () => refuse({ method: 'GET', path: '/api/libraries' }))
  it('refuses POST /api/lock/lock', () => refuse({ method: 'POST', path: '/api/lock/lock' }))
  it('refuses POST /api/admin/lock', () => refuse({ method: 'POST', path: '/api/admin/lock' }))
  it('refuses POST /api/admin/keep-unlocked', () =>
    refuse({ method: 'POST', path: '/api/admin/keep-unlocked' }))
  it('refuses PUT /api/media/1/favourite', () =>
    refuse({ method: 'PUT', path: '/api/media/1/favourite', body: '{"favourite":true}' }))
  it('refuses a near miss of a known path', () => {
    refuse({ method: 'PUT', path: '/api/media/1/progresss', body: '{"position":1}' })
    refuse({ method: 'PUT', path: '/api/media/1/progres', body: '{"position":1}' })
    refuse({ method: 'GET', path: '/api/media/1/trackss' })
    refuse({ method: 'GET', path: '/api/locks' })
    refuse({ method: 'GET', path: '/api/administrator' })
    refuse({ method: 'GET', path: '/api/media' })
    refuse({ method: 'GET', path: '/api/media/' })
  })
})

describe('matchCall refuses odd ids', () => {
  it('refuses GET /api/media/0', () => refuse({ method: 'GET', path: '/api/media/0' }))
  it('refuses GET /api/media/01', () => refuse({ method: 'GET', path: '/api/media/01' }))
  it('refuses a negative, signed, fractional or exponent id', () => {
    refuse({ method: 'GET', path: '/api/media/-1' })
    refuse({ method: 'GET', path: '/api/media/+1' })
    refuse({ method: 'GET', path: '/api/media/1.5' })
    refuse({ method: 'GET', path: '/api/media/1e3' })
    refuse({ method: 'GET', path: '/api/media/0x10' })
  })
  it('refuses an id past the safe integers', () => {
    refuse({ method: 'GET', path: '/api/media/9007199254740992' })
    refuse({ method: 'GET', path: '/api/media/9007199254740993' })
    refuse({ method: 'GET', path: '/api/media/99999999999999999' })
  })
  it('refuses an id in other digits', () => refuse({ method: 'GET', path: '/api/media/\u0661' }))
})

describe('matchCall refuses paths that are not exact', () => {
  it('refuses GET /api/media/1?x=1', () => refuse({ method: 'GET', path: '/api/media/1?x=1' }))
  it('refuses a bare question mark', () => refuse({ method: 'GET', path: '/api/lock?' }))
  it('refuses GET /api/media/1/', () => refuse({ method: 'GET', path: '/api/media/1/' }))
  it('refuses GET /api/media/1#x', () => refuse({ method: 'GET', path: '/api/media/1#x' }))
  it('refuses GET /api/media/../admin', () =>
    refuse({ method: 'GET', path: '/api/media/../admin' }))
  it('refuses a path that walks back out of a known one', () => {
    refuse({ method: 'GET', path: '/api/media/1/../../admin' })
    refuse({ method: 'GET', path: '/api/media/1/./tracks' })
    refuse({ method: 'GET', path: '/api/media/1/%2e%2e/%2e%2e/admin' })
    refuse({ method: 'GET', path: '/api/media/1%2Ftracks' })
    refuse({ method: 'GET', path: '/api%2Flock' })
    refuse({ method: 'GET', path: '/api/l%6Fck' })
  })
  it('refuses doubled slashes and backslashes', () => {
    refuse({ method: 'GET', path: '//api/lock' })
    refuse({ method: 'GET', path: '/api//lock' })
    refuse({ method: 'GET', path: '\\api\\lock' })
    refuse({ method: 'GET', path: '/api\\lock' })
  })
  it('refuses GET //evil.example/api/lock', () =>
    refuse({ method: 'GET', path: '//evil.example/api/lock' }))
  it('refuses GET https://evil.example/api/lock', () =>
    refuse({ method: 'GET', path: 'https://evil.example/api/lock' }))
  it('refuses a path with no leading slash', () => refuse({ method: 'GET', path: 'api/lock' }))
  it('refuses a path with a line break, a NUL or spaces around it', () => {
    refuse({ method: 'GET', path: '/api/lock\n' })
    refuse({ method: 'GET', path: '/api/lock\r\nX-Evil: 1' })
    refuse({ method: 'GET', path: '/api/lock\u0000' })
    refuse({ method: 'GET', path: ' /api/lock' })
    refuse({ method: 'GET', path: '/api/lock ' })
    refuse({ method: 'GET', path: '/api/media/1\n/tracks' })
  })
  it('refuses a path in other cases', () => {
    refuse({ method: 'GET', path: '/API/lock' })
    refuse({ method: 'GET', path: '/api/Lock' })
  })
  it('refuses an empty path', () => refuse({ method: 'GET', path: '' }))
})

describe('matchCall refuses the wrong method', () => {
  it('refuses get /api/lock', () => refuse({ method: 'get', path: '/api/lock' }))
  it('refuses a method with spaces or a line break', () => {
    refuse({ method: ' GET', path: '/api/lock' })
    refuse({ method: 'GET\r\n', path: '/api/lock' })
  })
  it('refuses PUT where GET is allowed', () => refuse({ method: 'PUT', path: '/api/media/1' }))
  it('refuses POST where GET is allowed', () => refuse({ method: 'POST', path: '/api/lock' }))
  it('refuses GET where PUT is allowed', () =>
    refuse({ method: 'GET', path: '/api/media/1/progress' }))
  it('refuses PUT where POST is allowed', () =>
    refuse({ method: 'PUT', path: '/api/lock/unlock', body: '{"pin":"1"}' }))
  it('refuses HEAD, OPTIONS and PATCH', () => {
    refuse({ method: 'HEAD', path: '/api/lock' })
    refuse({ method: 'OPTIONS', path: '/api/lock' })
    refuse({ method: 'PATCH', path: '/api/media/1/progress', body: '{"position":1}' })
  })
})

describe('matchCall refuses bodies that do not fit the call', () => {
  it('refuses GET /api/lock with a body', () =>
    refuse({ method: 'GET', path: '/api/lock', body: '{}' }))
  it('refuses an empty body where none is taken', () =>
    refuse({ method: 'GET', path: '/api/media/1', body: '' }))
  it('refuses POST /api/media/1/plays with a body', () =>
    refuse({ method: 'POST', path: '/api/media/1/plays', body: '{}' }))
  it('refuses PUT .../progress with {"position":"x"}', () =>
    refuse({ method: 'PUT', path: '/api/media/1/progress', body: '{"position":"x"}' }))
  it('refuses PUT .../progress with no body', () =>
    refuse({ method: 'PUT', path: '/api/media/1/progress' }))
  it('refuses PUT .../progress with 5,000 characters', () => {
    const body = `{"position":40${' '.repeat(5000)}}`
    expect(body.length).toBeGreaterThan(MAX_BODY)
    refuse({ method: 'PUT', path: '/api/media/1/progress', body })
  })
  it('refuses a body one character past MAX_BODY', () => {
    const body = `{"position":40${' '.repeat(MAX_BODY - '{"position":40}'.length + 1)}}`
    refuse({ method: 'PUT', path: '/api/media/1/progress', body })
  })
  it('refuses a negative position', () =>
    refuse({ method: 'PUT', path: '/api/media/1/progress', body: '{"position":-1}' }))
  it('refuses a body that is not JSON', () => {
    refuse({ method: 'PUT', path: '/api/media/1/progress', body: 'position=40' })
    refuse({ method: 'PUT', path: '/api/media/1/progress', body: '{"position":40' })
    refuse({ method: 'PUT', path: '/api/media/1/progress', body: '' })
  })
  it('refuses a JSON body that is not an object', () => {
    refuse({ method: 'PUT', path: '/api/media/1/progress', body: '40' })
    refuse({ method: 'PUT', path: '/api/media/1/progress', body: '[40]' })
    refuse({ method: 'PUT', path: '/api/media/1/progress', body: 'null' })
  })
  it('refuses a position hidden behind __proto__', () =>
    refuse({ method: 'PUT', path: '/api/media/1/progress', body: '{"__proto__":{"position":1}}' }))
  it('refuses POST /api/lock/unlock with a 300-character PIN', () =>
    refuse({
      method: 'POST',
      path: '/api/lock/unlock',
      body: JSON.stringify({ pin: 'a'.repeat(300) }),
    }))
  it('refuses a PIN one past MAX_SECRET and a password one past it', () => {
    refuse({
      method: 'POST',
      path: '/api/lock/unlock',
      body: JSON.stringify({ pin: 'a'.repeat(MAX_SECRET + 1) }),
    })
    refuse({
      method: 'POST',
      path: '/api/admin/unlock',
      body: JSON.stringify({ password: 'a'.repeat(MAX_SECRET + 1) }),
    })
  })
  it('refuses a PIN that is not a string', () => {
    refuse({ method: 'POST', path: '/api/lock/unlock', body: '{"pin":1234}' })
    refuse({ method: 'POST', path: '/api/lock/unlock', body: '{}' })
    refuse({ method: 'POST', path: '/api/lock/unlock' })
  })
  it('refuses a password in the PIN call and a PIN in the password call', () => {
    refuse({ method: 'POST', path: '/api/lock/unlock', body: '{"password":"p"}' })
    refuse({ method: 'POST', path: '/api/admin/unlock', body: '{"pin":"1"}' })
  })
})
