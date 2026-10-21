import { describe, expect, it } from 'bun:test'

import { ADD_OUTCOMES, type AppServer } from '@/servers/serverList'
import { SERVER_LIST_KEY, createActiveServerStore } from '@/servers/activeServerStore'
import { PIN } from '@/test/accountPins'
import { failingStore, memoryStore } from '@/test/memoryStore'

const NAS: AppServer = {
  id: '0f8fad5b-d9cb-469f-a165-70867728950e',
  name: 'nas:8080',
  origin: 'http://nas:8080',
  addedAt: 1,
  account: null,
}

const noJar = { forget: async () => {} }

const DEN: AppServer = {
  id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  name: 'den:8080',
  origin: 'http://den:8080',
  addedAt: 2,
  account: null,
}

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

describe('createActiveServerStore', () => {
  it('keeps the list and the active id as one value under raven.servers', async () => {
    const { store, items } = memoryStore()
    const useServers = createActiveServerStore({ store, jar: noJar })
    expect(useServers.getState().add(NAS).kind).toBe(ADD_OUTCOMES.added)
    useServers.getState().activate(NAS.id)
    await Promise.resolve()
    expect(SERVER_LIST_KEY).toBe('raven.servers')
    expect(JSON.parse(items.get(SERVER_LIST_KEY) ?? '')).toMatchObject({
      state: { servers: [NAS], activeId: NAS.id },
    })
  })

  it('reads them back in a new launch', async () => {
    const { store } = memoryStore()
    const first = createActiveServerStore({ store, jar: noJar })
    first.getState().add(NAS)
    first.getState().activate(NAS.id)
    await Promise.resolve()

    const next = createActiveServerStore({ store, jar: noJar })
    expect(next.getState().servers).toEqual([])
    await next.persist.rehydrate()
    expect(next.getState()).toMatchObject({ servers: [NAS], activeId: NAS.id })
  })

  it('guards what it reads: a malformed server is dropped, and so is an id that names none', async () => {
    const stored = {
      state: { servers: [NAS, { ...NAS, origin: 'x' }], activeId: 'gone' },
      version: 0,
    }
    const { store } = memoryStore([[SERVER_LIST_KEY, JSON.stringify(stored)]])
    const useServers = createActiveServerStore({ store, jar: noJar })
    await useServers.persist.rehydrate()
    expect(useServers.getState()).toMatchObject({ servers: [NAS], activeId: null })
  })

  it('starts empty from a value that is not JSON', async () => {
    const { store } = memoryStore([[SERVER_LIST_KEY, 'not json']])
    const useServers = createActiveServerStore({ store, jar: noJar })
    await useServers.persist.rehydrate()
    expect(useServers.getState()).toMatchObject({ servers: [], activeId: null })
  })

  it('works for the run when the store fails, rather than failing', async () => {
    const useServers = createActiveServerStore({ store: failingStore, jar: noJar })
    await useServers.persist.rehydrate()
    useServers.getState().add(NAS)
    useServers.getState().activate(NAS.id)
    await Promise.resolve()
    expect(useServers.getState()).toMatchObject({ servers: [NAS], activeId: NAS.id })
  })

  it("drops a server with its cookies, and the active id when it was that one's", async () => {
    const forgotten: string[] = []
    const jar = {
      forget: async (serverId: string) => {
        forgotten.push(serverId)
      },
    }
    const useServers = createActiveServerStore({ store: memoryStore().store, jar })
    useServers.getState().add(NAS)
    useServers.getState().activate(NAS.id)
    await useServers.getState().remove(NAS.id)
    expect(useServers.getState()).toMatchObject({ servers: [], activeId: null })
    expect(forgotten).toEqual([NAS.id])
  })

  it('switches to the next server left when the active one is removed, forgetting its cookies', async () => {
    const { forgotten, jar } = recordingJar()
    const useServers = createActiveServerStore({ store: memoryStore().store, jar })
    useServers.getState().add(NAS)
    useServers.getState().add(DEN)
    useServers.getState().activate(NAS.id)
    await useServers.getState().remove(NAS.id)
    expect(useServers.getState()).toMatchObject({ servers: [DEN], activeId: DEN.id })
    expect(forgotten).toEqual([NAS.id])
  })

  it('keeps the active server when another is removed', async () => {
    const { forgotten, jar } = recordingJar()
    const useServers = createActiveServerStore({ store: memoryStore().store, jar })
    useServers.getState().add(NAS)
    useServers.getState().add(DEN)
    useServers.getState().activate(NAS.id)
    await useServers.getState().remove(DEN.id)
    expect(useServers.getState()).toMatchObject({ servers: [NAS], activeId: NAS.id })
    expect(forgotten).toEqual([DEN.id])
  })

  it('renames a server and keeps the name, refusing a name the list will not take', async () => {
    const { store, items } = memoryStore()
    const useServers = createActiveServerStore({ store, jar: noJar })
    useServers.getState().add(NAS)
    expect(useServers.getState().rename({ id: NAS.id, name: ' Attic ' })).toBe(true)
    expect(useServers.getState().rename({ id: NAS.id, name: '' })).toBe(false)
    await Promise.resolve()
    expect(useServers.getState().servers).toEqual([{ ...NAS, name: 'Attic' }])
    expect(JSON.parse(items.get(SERVER_LIST_KEY) ?? '')).toMatchObject({
      state: { servers: [{ ...NAS, name: 'Attic' }] },
    })
  })

  it("keeps a server's pinned sign-in with it, and reads it back in a new launch", async () => {
    const { store } = memoryStore()
    const first = createActiveServerStore({ store, jar: noJar })
    first.getState().add(NAS)
    expect(first.getState().pin({ id: NAS.id, account: PIN })).toBe(true)
    expect(first.getState().pin({ id: DEN.id, account: PIN })).toBe(false)
    await Promise.resolve()

    const next = createActiveServerStore({ store, jar: noJar })
    await next.persist.rehydrate()
    expect(next.getState().servers).toEqual([{ ...NAS, account: PIN }])
  })

  it('forgets the pin with the server, so adding it again starts with none', async () => {
    const { store, items } = memoryStore()
    const useServers = createActiveServerStore({ store, jar: noJar })
    useServers.getState().add(NAS)
    useServers.getState().pin({ id: NAS.id, account: PIN })
    await useServers.getState().remove(NAS.id)
    expect(items.get(SERVER_LIST_KEY) ?? '').not.toContain(PIN.supabaseUrl)
    useServers.getState().add(NAS)
    expect(useServers.getState().servers).toEqual([NAS])
  })
})
