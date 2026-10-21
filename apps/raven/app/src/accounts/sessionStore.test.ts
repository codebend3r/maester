import { describe, expect, it } from 'bun:test'

import { SESSION_STORAGE_KEY } from '@/accounts/accountSessions'
import { accountKeyFor, createSessionStore } from '@/accounts/sessionStore'
import type { SecretStore } from '@/servers/secretStore'
import { failingStore, memoryStore } from '@/test/memoryStore'

const SERVER = '0f8fad5b-d9cb-469f-a165-70867728950e'
const OTHER = '7c9e6679-7425-40de-944b-e07fc1f90ae7'
const SESSION_KEY = SESSION_STORAGE_KEY
/** Where auth-js keeps the user beside the session. */
const USER_KEY = `${SESSION_STORAGE_KEY}-user`

/** A store whose reads fail until `heal` is called, as a keychain that comes back mid-run. */
const flakyStore = () => {
  const { store, items } = memoryStore()
  const health = { isFailing: true }
  const flaky: SecretStore = {
    ...store,
    getItemAsync: async (key) => {
      if (health.isFailing) throw new Error('A required entitlement is not present.')
      return store.getItemAsync(key)
    },
  }
  const heal = () => {
    health.isFailing = false
  }
  return { store: flaky, items, heal }
}

describe('createSessionStore', () => {
  it("keeps each server's sign-in as one JSON value under raven.account.<serverId>", async () => {
    const { store, items } = memoryStore()
    const storage = createSessionStore({ store }).storageFor(SERVER)
    await storage.setItem(SESSION_KEY, '{"access_token":"a"}')
    await storage.setItem(USER_KEY, '{"id":"u"}')
    expect(accountKeyFor(SERVER)).toBe(`raven.account.${SERVER}`)
    expect([...items.keys()]).toEqual([accountKeyFor(SERVER)])
    expect(JSON.parse(items.get(accountKeyFor(SERVER)) ?? '')).toEqual({
      [SESSION_KEY]: '{"access_token":"a"}',
      [USER_KEY]: '{"id":"u"}',
    })
  })

  it('reads it back in a new launch, and keeps one server apart from another', async () => {
    const { store } = memoryStore()
    await createSessionStore({ store }).storageFor(SERVER).setItem(SESSION_KEY, 'kept')
    const next = createSessionStore({ store })
    expect(await next.storageFor(SERVER).getItem(SESSION_KEY)).toBe('kept')
    expect(await next.storageFor(OTHER).getItem(SESSION_KEY)).toBeNull()
  })

  it('deletes the value once nothing is left in it', async () => {
    const { store, items } = memoryStore()
    const storage = createSessionStore({ store }).storageFor(SERVER)
    await storage.setItem(SESSION_KEY, 'kept')
    await storage.removeItem(SESSION_KEY)
    expect(items.has(accountKeyFor(SERVER))).toBe(false)
  })

  it.each([
    ['not JSON', `{"${SESSION_KEY}":`],
    ['not an object', '["kept"]'],
    ['an item that is not text', JSON.stringify({ [SESSION_KEY]: { access_token: 'a' } })],
  ])('reads a value that is %s as signed out, and removes it', async (_name, stored) => {
    const { store, items } = memoryStore([[accountKeyFor(SERVER), stored]])
    expect(await createSessionStore({ store }).storageFor(SERVER).getItem(SESSION_KEY)).toBeNull()
    expect(items.has(accountKeyFor(SERVER))).toBe(false)
  })

  it('signs out for the run when the store throws, though it answers again later', async () => {
    const { store, items, heal } = flakyStore()
    items.set(accountKeyFor(SERVER), JSON.stringify({ [SESSION_KEY]: 'kept' }))
    const storage = createSessionStore({ store }).storageFor(SERVER)
    expect(await storage.getItem(SESSION_KEY)).toBeNull()
    heal()
    expect(await storage.getItem(SESSION_KEY)).toBeNull()
  })

  it('keeps a sign-in for the run alone when the store cannot save it', async () => {
    const sessions = createSessionStore({ store: failingStore })
    await sessions.storageFor(SERVER).setItem(SESSION_KEY, 'kept')
    expect(await sessions.storageFor(SERVER).getItem(SESSION_KEY)).toBe('kept')
    expect(
      await createSessionStore({ store: failingStore }).storageFor(SERVER).getItem(SESSION_KEY),
    ).toBeNull()
  })

  it("forgets a server's sign-in in memory and in the store", async () => {
    const { store, items } = memoryStore()
    const sessions = createSessionStore({ store })
    await sessions.storageFor(SERVER).setItem(SESSION_KEY, 'kept')
    await sessions.storageFor(OTHER).setItem(SESSION_KEY, 'other')
    await sessions.forget(SERVER)
    expect(await sessions.storageFor(SERVER).getItem(SESSION_KEY)).toBeNull()
    expect([...items.keys()]).toEqual([accountKeyFor(OTHER)])
  })

  it('applies writes that land together in turn, so neither loses the other', async () => {
    const { store, items } = memoryStore()
    const storage = createSessionStore({ store }).storageFor(SERVER)
    await Promise.all([storage.setItem(SESSION_KEY, 'a'), storage.setItem(USER_KEY, 'b')])
    expect(JSON.parse(items.get(accountKeyFor(SERVER)) ?? '')).toEqual({
      [SESSION_KEY]: 'a',
      [USER_KEY]: 'b',
    })
  })

  it('refuses a server id that could name another key', () => {
    expect(() => createSessionStore({ store: memoryStore().store }).storageFor('../x')).toThrow()
  })
})
