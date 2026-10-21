import { describe, expect, it } from 'bun:test'

import { SERVERS_CAP } from '@raven/core'

import {
  ADD_OUTCOMES,
  type AppServer,
  addServer,
  removeServer,
  pinServer,
  storedServersOf,
} from '@/servers/serverList'
import { MOVED_PIN, PIN } from '@/test/accountPins'

const NAS: AppServer = {
  id: '0f8fad5b-d9cb-469f-a165-70867728950e',
  name: 'nas:8080',
  origin: 'http://nas:8080',
  addedAt: 1,
  account: null,
}
const NEW_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7'

/** `count` well-formed servers, each with its own id and origin. */
const serversOf = (count: number): AppServer[] =>
  Array.from({ length: count }, (_, n) => ({
    id: `0f8fad5b-d9cb-469f-a165-${String(n).padStart(12, '0')}`,
    name: `nas${n}`,
    origin: `http://nas${n}:8080`,
    addedAt: n,
    account: null,
  }))

describe('addServer', () => {
  const NEW: AppServer = {
    id: NEW_ID,
    name: 'other:8080',
    origin: 'http://other:8080',
    addedAt: 5,
    account: null,
  }

  it('adds a well-formed server at the end', () => {
    expect(addServer({ servers: [NAS], server: NEW })).toEqual({
      kind: ADD_OUTCOMES.added,
      servers: [NAS, NEW],
    })
  })

  it.each(['HTTP://other:8080', 'http://other:8080/', 'http://other:8080/path', 'other:8080'])(
    'refuses the origin %p, which serverOriginOf would not write',
    (origin) => {
      expect(addServer({ servers: [], server: { ...NEW, origin } })).toEqual({
        kind: ADD_OUTCOMES.invalid,
      })
    },
  )

  it('refuses an id that is not a random UUID', () => {
    expect(addServer({ servers: [], server: { ...NEW, id: '../x' } })).toEqual({
      kind: ADD_OUTCOMES.invalid,
    })
  })

  it('adds a server with its sign-in pinned', () => {
    expect(addServer({ servers: [], server: { ...NEW, account: PIN } })).toEqual({
      kind: ADD_OUTCOMES.added,
      servers: [{ ...NEW, account: PIN }],
    })
  })

  it('refuses a pin the app could not sign in through', () => {
    const account = { ...PIN, supabaseUrl: 'http://project.supabase.co' }
    expect(addServer({ servers: [], server: { ...NEW, account } })).toEqual({
      kind: ADD_OUTCOMES.invalid,
    })
  })

  it('refuses an origin or an id already on the list', () => {
    expect(addServer({ servers: [NAS], server: { ...NEW, origin: NAS.origin } })).toEqual({
      kind: ADD_OUTCOMES.taken,
    })
    expect(addServer({ servers: [NAS], server: { ...NEW, id: NAS.id } })).toEqual({
      kind: ADD_OUTCOMES.taken,
    })
  })

  it('refuses one more once the list holds SERVERS_CAP', () => {
    const full = serversOf(SERVERS_CAP)
    expect(addServer({ servers: full, server: NEW })).toEqual({ kind: ADD_OUTCOMES.full })
    expect(addServer({ servers: full.slice(1), server: NEW }).kind).toBe(ADD_OUTCOMES.added)
  })
})

describe('removeServer', () => {
  it('drops the server with that id and keeps the rest', () => {
    const other = { ...NAS, id: NEW_ID, origin: 'http://other:8080' }
    expect(removeServer({ servers: [NAS, other], id: NAS.id })).toEqual([other])
  })
})

describe('pinServer', () => {
  it("pins a listed server's sign-in, and pins it again in place of the old", () => {
    const pinned = pinServer({ servers: [NAS], id: NAS.id, account: PIN })
    expect(pinned).toEqual([{ ...NAS, account: PIN }])
    expect(pinServer({ servers: pinned ?? [], id: NAS.id, account: MOVED_PIN })).toEqual([
      { ...NAS, account: MOVED_PIN },
    ])
  })

  it('pins nothing for a server not on the list, or endpoints the app cannot use', () => {
    expect(pinServer({ servers: [NAS], id: NEW_ID, account: PIN })).toBeNull()
    expect(
      pinServer({ servers: [NAS], id: NAS.id, account: { ...PIN, webUrl: 'javascript:alert(1)' } }),
    ).toBeNull()
  })
})

describe('storedServersOf', () => {
  it('reads back a pinned sign-in', () => {
    const pinned = { ...NAS, account: PIN }
    expect(storedServersOf({ servers: [pinned], activeId: null }).servers).toEqual([pinned])
  })

  it.each([
    ['a server kept before accounts, with no pin at all', undefined],
    ['a pin missing a part', { supabaseUrl: PIN.supabaseUrl, webUrl: PIN.webUrl }],
    ['a pin to plain http off the loopback', { ...PIN, supabaseUrl: 'http://project.test' }],
    ['a secret key in place of the publishable one', { ...PIN, publishableKey: 'sb_secret_x' }],
    ['a pin that is no object', 'https://project.supabase.co'],
  ])('reads %s as no pin, and keeps the server', (_name, account) => {
    expect(storedServersOf({ servers: [{ ...NAS, account }], activeId: NAS.id })).toEqual({
      servers: [NAS],
      activeId: NAS.id,
    })
  })

  it('reads back what was stored', () => {
    expect(storedServersOf({ servers: [NAS], activeId: NAS.id })).toEqual({
      servers: [NAS],
      activeId: NAS.id,
    })
  })

  it('keeps only the fields a server has', () => {
    expect(storedServersOf({ servers: [{ ...NAS, cookie: 'x' }], activeId: null })).toEqual({
      servers: [NAS],
      activeId: null,
    })
  })

  it('drops a malformed entry and a repeated origin or id, keeping the first', () => {
    const stored = {
      servers: [
        NAS,
        { ...NAS, id: NEW_ID },
        { ...NAS, origin: 'http://other:8080' },
        { ...NAS, id: '9b2d3f4e-1a2b-4c3d-8e9f-0a1b2c3d4e5f', origin: 'http://nas:8080/x' },
        'x',
      ],
      activeId: NAS.id,
    }
    expect(storedServersOf(stored)).toEqual({ servers: [NAS], activeId: NAS.id })
  })

  it('keeps no more than SERVERS_CAP, the first ones', () => {
    const stored = serversOf(SERVERS_CAP + 2)
    expect(storedServersOf({ servers: stored, activeId: null }).servers).toEqual(
      stored.slice(0, SERVERS_CAP),
    )
  })

  it('forgets an active id that names no stored server', () => {
    expect(storedServersOf({ servers: [NAS], activeId: NEW_ID })).toEqual({
      servers: [NAS],
      activeId: null,
    })
  })

  it.each([[null], [undefined], ['x'], [{ servers: 'x' }], [{}]])(
    'starts empty from %p',
    (stored) => {
      expect(storedServersOf(stored)).toEqual({ servers: [], activeId: null })
    },
  )
})
