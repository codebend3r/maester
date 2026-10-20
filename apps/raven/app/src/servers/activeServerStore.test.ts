import { describe, expect, it } from 'bun:test'

import { ADD_OUTCOMES, type AppServer } from '@/servers/serverList'
import { SERVER_LIST_KEY, createActiveServerStore } from '@/servers/activeServerStore'
import { failingStore, memoryStore } from '@/test/memoryStore'

const NAS: AppServer = {
  id: '0f8fad5b-d9cb-469f-a165-70867728950e',
  name: 'nas:8080',
  origin: 'http://nas:8080',
  addedAt: 1,
}

const noJar = { forget: async () => {} }

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
})
