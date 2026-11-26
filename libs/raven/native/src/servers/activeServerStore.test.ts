import { describe, expect, it } from 'bun:test'

import { ADD_OUTCOMES, type AppServer } from '@/servers/serverList'
import type { CookieJar } from '@/servers/cookieJar'
import {
  SERVER_LIST_KEY,
  createActiveServerStore,
  hasSeveralServers,
} from '@/servers/activeServerStore'
import { failingStore, memoryStore } from '@/test/memoryStore'

const HOME: AppServer = {
  id: '7c1f4e2a-3b5d-4a6e-8f90-1a2b3c4d5e6f',
  name: 'raven',
  origin: 'https://home.example',
  addedAt: 0,
}

const HOME_SERVER_ID = '3f2b1c0d-9e8f-4a7b-8c6d-5e4f3a2b1c0d'

const NAS: AppServer = {
  id: '0f8fad5b-d9cb-469f-a165-70867728950e',
  name: 'nas:8080',
  origin: 'http://nas:8080',
  addedAt: 1,
}

const DEN: AppServer = {
  id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  name: 'den:8080',
  origin: 'http://den:8080',
  addedAt: 2,
}

type ForgettingJar = Pick<CookieJar, 'forget'>

const noJar: ForgettingJar = { forget: async () => {} }

/** A jar that records the servers whose cookies it forgot. */
const recordingJar = () => {
  const forgotten: string[] = []
  return {
    forgotten,
    jar: {
      forget: async (serverId: string) => {
        forgotten.push(serverId)
      },
    },
  }
}

type StoreOfProps = { store?: ReturnType<typeof memoryStore>['store']; jar?: ForgettingJar }

const storeOf = ({ store = memoryStore().store, jar = noJar }: StoreOfProps = {}) =>
  createActiveServerStore({ store, jar, home: HOME })

describe('createActiveServerStore', () => {
  it('starts on home, the one server, before anything is read', () => {
    expect(storeOf().getState()).toMatchObject({
      servers: [HOME],
      activeId: HOME.id,
      homeServerId: null,
    })
  })

  it("follows the account's list after home and keeps it, with the active id, under raven.servers", async () => {
    const { store, items } = memoryStore()
    const useServers = storeOf({ store })
    await useServers
      .getState()
      .follow({ servers: [NAS, DEN], homeServerId: HOME_SERVER_ID, homeName: null })
    useServers.getState().activate(NAS.id)
    await Promise.resolve()
    expect(SERVER_LIST_KEY).toBe('raven.servers')
    expect(JSON.parse(items.get(SERVER_LIST_KEY) ?? '')).toMatchObject({
      state: { servers: [HOME, NAS, DEN], activeId: NAS.id, homeServerId: HOME_SERVER_ID },
    })
  })

  it('reads them back in a new launch, the server last used still in use', async () => {
    const { store } = memoryStore()
    const first = storeOf({ store })
    await first.getState().follow({ servers: [NAS], homeServerId: HOME_SERVER_ID, homeName: null })
    first.getState().activate(NAS.id)
    await Promise.resolve()

    const next = storeOf({ store })
    await next.persist.rehydrate()
    expect(next.getState()).toMatchObject({
      servers: [HOME, NAS],
      activeId: NAS.id,
      homeServerId: HOME_SERVER_ID,
    })
  })

  it('puts home back first at the origin this build names, keeping the others', async () => {
    const stale = { ...HOME, origin: 'https://old.example' }
    const stored = { state: { servers: [stale, NAS], activeId: stale.id }, version: 0 }
    const { store } = memoryStore([[SERVER_LIST_KEY, JSON.stringify(stored)]])
    const useServers = storeOf({ store })
    await useServers.persist.rehydrate()
    expect(useServers.getState()).toMatchObject({ servers: [HOME, NAS], activeId: HOME.id })
  })

  it('guards what it reads: a malformed server is dropped, and an id that names none goes home', async () => {
    const stored = {
      state: { servers: [NAS, { ...DEN, origin: 'x' }], activeId: 'gone', homeServerId: 'x' },
      version: 0,
    }
    const { store } = memoryStore([[SERVER_LIST_KEY, JSON.stringify(stored)]])
    const useServers = storeOf({ store })
    await useServers.persist.rehydrate()
    expect(useServers.getState()).toMatchObject({
      servers: [HOME, NAS],
      activeId: HOME.id,
      homeServerId: null,
    })
  })

  it('starts on home from a value that is not JSON', async () => {
    const { store } = memoryStore([[SERVER_LIST_KEY, 'not json']])
    const useServers = storeOf({ store })
    await useServers.persist.rehydrate()
    expect(useServers.getState()).toMatchObject({ servers: [HOME], activeId: HOME.id })
  })

  it('works for the run when the store fails, rather than failing', async () => {
    const useServers = storeOf({ store: failingStore })
    await useServers.persist.rehydrate()
    await useServers.getState().follow({ servers: [NAS], homeServerId: null, homeName: null })
    useServers.getState().activate(NAS.id)
    expect(useServers.getState()).toMatchObject({ servers: [HOME, NAS], activeId: NAS.id })
  })

  it('goes home when the server in use leaves the list, forgetting its cookies', async () => {
    const { forgotten, jar } = recordingJar()
    const useServers = storeOf({ jar })
    await useServers.getState().follow({ servers: [NAS, DEN], homeServerId: null, homeName: null })
    useServers.getState().activate(NAS.id)
    await useServers.getState().follow({ servers: [DEN], homeServerId: null, homeName: null })
    expect(useServers.getState()).toMatchObject({ servers: [HOME, DEN], activeId: HOME.id })
    expect(forgotten).toEqual([NAS.id])
  })

  it('keeps the server in use while it stays on the list', async () => {
    const { forgotten, jar } = recordingJar()
    const useServers = storeOf({ jar })
    await useServers.getState().follow({ servers: [NAS, DEN], homeServerId: null, homeName: null })
    useServers.getState().activate(NAS.id)
    await useServers
      .getState()
      .follow({ servers: [{ ...NAS, name: 'Attic' }], homeServerId: null, homeName: null })
    expect(useServers.getState()).toMatchObject({
      servers: [HOME, { ...NAS, name: 'Attic' }],
      activeId: NAS.id,
    })
    expect(forgotten).toEqual([DEN.id])
  })

  it('leaves out a row naming home by its own id, and never removes home', async () => {
    const useServers = storeOf()
    const homeRow = { ...NAS, id: HOME_SERVER_ID, origin: 'https://home.lan' }
    await useServers
      .getState()
      .follow({ servers: [homeRow, DEN], homeServerId: HOME_SERVER_ID, homeName: null })
    expect(useServers.getState().servers).toEqual([HOME, DEN])
    await useServers
      .getState()
      .follow({ servers: [], homeServerId: HOME_SERVER_ID, homeName: null })
    expect(useServers.getState().servers).toEqual([HOME])
  })

  it("wears the account's name for home, keeps it for the next launch and lets it go with the account", async () => {
    const { store } = memoryStore()
    const first = storeOf({ store })
    await first
      .getState()
      .follow({ servers: [NAS], homeServerId: HOME_SERVER_ID, homeName: 'Vhagar' })
    const named = { ...HOME, name: 'Vhagar' }
    expect(first.getState()).toMatchObject({
      home: named,
      servers: [named, NAS],
      homeName: 'Vhagar',
    })
    await Promise.resolve()

    const next = storeOf({ store })
    await next.persist.rehydrate()
    expect(next.getState()).toMatchObject({
      home: named,
      servers: [named, NAS],
      homeName: 'Vhagar',
    })

    await next.getState().follow({ servers: [NAS], homeServerId: HOME_SERVER_ID, homeName: null })
    expect(next.getState()).toMatchObject({ home: HOME, servers: [HOME, NAS], homeName: null })
  })

  it('reads back no home name it could not have kept', async () => {
    const stored = { state: { servers: [HOME], activeId: HOME.id, homeName: '  x  ' }, version: 0 }
    const { store } = memoryStore([[SERVER_LIST_KEY, JSON.stringify(stored)]])
    const useServers = storeOf({ store })
    await useServers.persist.rehydrate()
    expect(useServers.getState()).toMatchObject({ home: HOME, homeName: null })
  })

  it('leaves the list as it was when a read changed nothing', async () => {
    const useServers = storeOf()
    await useServers
      .getState()
      .follow({ servers: [NAS], homeServerId: HOME_SERVER_ID, homeName: 'Vhagar' })
    const servers = useServers.getState().servers
    await useServers
      .getState()
      .follow({ servers: [{ ...NAS }], homeServerId: HOME_SERVER_ID, homeName: 'Vhagar' })
    expect(useServers.getState().servers).toBe(servers)
  })

  it('activates only a listed server', () => {
    const useServers = storeOf()
    useServers.getState().activate(NAS.id)
    expect(useServers.getState().activeId).toBe(HOME.id)
  })

  it('adds a server after home', () => {
    const useServers = storeOf()
    expect(useServers.getState().add(NAS).kind).toBe(ADD_OUTCOMES.added)
    expect(useServers.getState().servers).toEqual([HOME, NAS])
  })
})

describe('hasSeveralServers', () => {
  it('is true only once the list holds more than home', () => {
    expect(hasSeveralServers({ servers: [HOME] })).toBe(false)
    expect(hasSeveralServers({ servers: [HOME, NAS] })).toBe(true)
  })
})
