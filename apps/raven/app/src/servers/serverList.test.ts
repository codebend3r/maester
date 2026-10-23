import { describe, expect, it } from 'bun:test'

import { SERVERS_CAP } from '@raven/core'

import {
  ADD_OUTCOMES,
  type AppServer,
  addServer,
  removeServer,
  storedServersOf,
} from '@/servers/serverList'

const NAS: AppServer = {
  id: '0f8fad5b-d9cb-469f-a165-70867728950e',
  name: 'nas:8080',
  origin: 'http://nas:8080',
  addedAt: 1,
}
const NEW_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7'

/** `count` well-formed servers, each with its own id and origin. */
const serversOf = (count: number): AppServer[] =>
  Array.from({ length: count }, (_, n) => ({
    id: `0f8fad5b-d9cb-469f-a165-${String(n).padStart(12, '0')}`,
    name: `nas${n}`,
    origin: `http://nas${n}:8080`,
    addedAt: n,
  }))

describe('addServer', () => {
  const NEW: AppServer = { id: NEW_ID, name: 'other:8080', origin: 'http://other:8080', addedAt: 5 }

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

describe('storedServersOf', () => {
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
