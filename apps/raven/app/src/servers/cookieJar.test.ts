import { describe, expect, it } from 'bun:test'

import {
  COOKIE_CHANGES,
  cookieHeaderOf,
  cookieKeyFor,
  createCookieJar,
  readServerCookies,
} from '@/servers/cookieJar'
import { failingStore, memoryStore } from '@/test/memoryStore'

const SERVER_ID = '0f8fad5b-d9cb-469f-a165-70867728950e'
const KEY = `raven.cookie.${SERVER_ID}`

const set = (value: string) => ({ kind: COOKIE_CHANGES.set, value })
const cleared = { kind: COOKIE_CHANGES.cleared }

describe('readServerCookies', () => {
  it('reads the unlock cookie the server sets', () => {
    expect(readServerCookies('raven_unlock=abc; Path=/api; HttpOnly; SameSite=Strict')).toEqual({
      raven_unlock: set('abc'),
    })
  })

  it('reads the admin cookie, and keeps a signed value whole', () => {
    expect(
      readServerCookies(
        'raven_admin=1.2.Ab-_9z; Path=/api; HttpOnly; SameSite=Strict; Max-Age=34560000',
      ),
    ).toEqual({ raven_admin: set('1.2.Ab-_9z') })
  })

  it('ignores other cookies', () => {
    expect(readServerCookies('session=abc; Path=/')).toEqual({})
    expect(readServerCookies('xraven_unlock=abc; Path=/api')).toEqual({})
    expect(readServerCookies('a=1; raven_unlock=abc')).toEqual({})
  })

  it('reads both among headers joined with commas, as iOS and Android join them', () => {
    expect(
      readServerCookies(
        'probe=1; Path=/; Expires=Wed, 21 Oct 2026 07:28:00 GMT, raven_unlock=abc; Path=/api, raven_admin=x.y; Path=/api; Max-Age=60',
      ),
    ).toEqual({ raven_unlock: set('abc'), raven_admin: set('x.y') })
    expect(
      readServerCookies('session=1; Expires=Wed, 21 Oct 2026 07:28:00 GMT,raven_unlock=abc'),
    ).toEqual({ raven_unlock: set('abc') })
  })

  it('takes the last one when it is set twice', () => {
    expect(readServerCookies('raven_unlock=old; Path=/api, raven_unlock=new; Path=/api')).toEqual({
      raven_unlock: set('new'),
    })
  })

  it('tells a cleared cookie from an absent one', () => {
    expect(readServerCookies('raven_unlock=; Max-Age=0; Path=/api; HttpOnly')).toEqual({
      raven_unlock: cleared,
    })
    expect(readServerCookies('raven_admin=x.y; Path=/api; max-age=0')).toEqual({
      raven_admin: cleared,
    })
    expect(readServerCookies('raven_admin=x.y; Max-Age=-1')).toEqual({ raven_admin: cleared })
  })

  it('ignores a malformed value', () => {
    expect(readServerCookies('raven_unlock="abc"; Path=/api')).toEqual({})
    expect(readServerCookies('raven_unlock=a b; Path=/api')).toEqual({})
  })

  it('reads nothing with no header', () => {
    expect(readServerCookies(null)).toEqual({})
    expect(readServerCookies('')).toEqual({})
  })
})

describe('cookieHeaderOf', () => {
  it('sends the unlock cookie first, then the admin one', () => {
    expect(cookieHeaderOf({ raven_admin: 'b', raven_unlock: 'a' })).toBe(
      'raven_unlock=a; raven_admin=b',
    )
    expect(cookieHeaderOf({ raven_admin: 'b' })).toBe('raven_admin=b')
  })

  it('is null with none', () => {
    expect(cookieHeaderOf({})).toBeNull()
  })
})

describe('createCookieJar', () => {
  it("keeps both of a server's cookies under raven.cookie.<serverId>", async () => {
    const { store, items } = memoryStore()
    const jar = createCookieJar({ store })
    await jar.apply({ serverId: SERVER_ID, changes: { raven_unlock: set('a') } })
    await jar.apply({ serverId: SERVER_ID, changes: { raven_admin: set('b') } })
    expect(cookieKeyFor(SERVER_ID)).toBe(KEY)
    expect(JSON.parse(items.get(KEY) ?? '')).toEqual({ raven_unlock: 'a', raven_admin: 'b' })
    expect(await jar.read(SERVER_ID)).toEqual({ raven_unlock: 'a', raven_admin: 'b' })
  })

  it('reads stored cookies back once, then from memory', async () => {
    const { store, reads } = memoryStore([[KEY, '{"raven_unlock":"a","raven_admin":"b"}']])
    const jar = createCookieJar({ store })
    expect(await jar.read(SERVER_ID)).toEqual({ raven_unlock: 'a', raven_admin: 'b' })
    expect(await jar.read(SERVER_ID)).toEqual({ raven_unlock: 'a', raven_admin: 'b' })
    expect(reads).toEqual([KEY])
  })

  it('reads only well-formed cookies from what was stored', async () => {
    const { store } = memoryStore([[KEY, '{"raven_unlock":"a; b","raven_admin":"b","other":"c"}']])
    expect(await createCookieJar({ store }).read(SERVER_ID)).toEqual({ raven_admin: 'b' })
    const broken = memoryStore([[KEY, 'not json']])
    expect(await createCookieJar({ store: broken.store }).read(SERVER_ID)).toEqual({})
  })

  it('drops a cleared cookie and keeps the other', async () => {
    const { store, items } = memoryStore([[KEY, '{"raven_unlock":"a","raven_admin":"b"}']])
    const jar = createCookieJar({ store })
    await jar.apply({ serverId: SERVER_ID, changes: { raven_unlock: cleared } })
    expect(await jar.read(SERVER_ID)).toEqual({ raven_admin: 'b' })
    expect(JSON.parse(items.get(KEY) ?? '')).toEqual({ raven_admin: 'b' })
  })

  it('deletes the entry once both are cleared', async () => {
    const { store, items } = memoryStore([[KEY, '{"raven_unlock":"a"}']])
    await createCookieJar({ store }).apply({
      serverId: SERVER_ID,
      changes: { raven_unlock: cleared },
    })
    expect(items.has(KEY)).toBe(false)
  })

  it('keeps both cookies when two responses set them at once', async () => {
    const { store, items } = memoryStore()
    const jar = createCookieJar({ store })
    await Promise.all([
      jar.apply({ serverId: SERVER_ID, changes: { raven_unlock: set('a') } }),
      jar.apply({ serverId: SERVER_ID, changes: { raven_admin: set('b') } }),
    ])
    expect(await jar.read(SERVER_ID)).toEqual({ raven_unlock: 'a', raven_admin: 'b' })
    expect(JSON.parse(items.get(KEY) ?? '')).toEqual({ raven_unlock: 'a', raven_admin: 'b' })
  })

  it('reads a cookie set alongside a forget in the order they came', async () => {
    const { store } = memoryStore([[KEY, '{"raven_unlock":"a"}']])
    const jar = createCookieJar({ store })
    await Promise.all([
      jar.forget(SERVER_ID),
      jar.apply({ serverId: SERVER_ID, changes: { raven_admin: set('b') } }),
    ])
    expect(await jar.read(SERVER_ID)).toEqual({ raven_admin: 'b' })
  })

  it('forgets a server', async () => {
    const { store, items } = memoryStore([[KEY, '{"raven_unlock":"a"}']])
    const jar = createCookieJar({ store })
    await jar.forget(SERVER_ID)
    expect(await jar.read(SERVER_ID)).toEqual({})
    expect(items.size).toBe(0)
  })

  it('reads no cookies when the store fails, rather than failing the request', async () => {
    expect(await createCookieJar({ store: failingStore }).read(SERVER_ID)).toEqual({})
  })

  it('keeps cookies for this run when the store fails to save them', async () => {
    const jar = createCookieJar({ store: failingStore })
    await jar.apply({ serverId: SERVER_ID, changes: { raven_unlock: set('a') } })
    expect(await jar.read(SERVER_ID)).toEqual({ raven_unlock: 'a' })
    await jar.forget(SERVER_ID)
    expect(await jar.read(SERVER_ID)).toEqual({})
  })

  it('says which server changed on every write and forget, once each, after memory holds it', async () => {
    const { store } = memoryStore()
    const changed: Array<{ serverId: string; cookies: unknown }> = []
    const jar = createCookieJar({
      store,
      onChange: (serverId) => {
        void jar.read(serverId).then((cookies) => changed.push({ serverId, cookies }))
      },
    })
    await jar.read(SERVER_ID)
    expect(changed).toEqual([])
    await jar.apply({ serverId: SERVER_ID, changes: { raven_unlock: set('a') } })
    await jar.apply({ serverId: SERVER_ID, changes: { raven_unlock: cleared } })
    await jar.forget(SERVER_ID)
    expect(changed).toEqual([
      { serverId: SERVER_ID, cookies: { raven_unlock: 'a' } },
      { serverId: SERVER_ID, cookies: {} },
      { serverId: SERVER_ID, cookies: {} },
    ])
  })
})
