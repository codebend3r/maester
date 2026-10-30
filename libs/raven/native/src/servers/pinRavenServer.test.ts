import { describe, expect, it } from 'bun:test'

import { createActiveServerStore } from '@/servers/activeServerStore'
import { pinRavenServer } from '@/servers/pinRavenServer'
import { RAVEN_SERVER } from '@/servers/ravenServer'
import type { AppServer } from '@/servers/serverList'
import { memoryStore } from '@/test/memoryStore'

const NAS: AppServer = {
  id: '0f8fad5b-d9cb-469f-a165-70867728950e',
  name: 'nas:8080',
  origin: 'http://nas:8080',
  addedAt: 1,
}

describe('pinRavenServer', () => {
  it('leaves raven the one server, and the active one', async () => {
    const forgotten: string[] = []
    const useServers = createActiveServerStore({
      store: memoryStore().store,
      jar: {
        forget: async (id) => {
          forgotten.push(id)
        },
      },
    })
    useServers.getState().add(NAS)
    useServers.getState().activate(NAS.id)

    pinRavenServer({ servers: useServers })

    expect(useServers.getState()).toMatchObject({
      servers: [RAVEN_SERVER],
      activeId: RAVEN_SERVER.id,
    })
    expect(forgotten).toEqual([NAS.id])
  })

  it('keeps raven as it was when it is listed already', () => {
    const useServers = createActiveServerStore({
      store: memoryStore().store,
      jar: { forget: async () => {} },
    })
    useServers.getState().add(RAVEN_SERVER)
    pinRavenServer({ servers: useServers })
    expect(useServers.getState().servers).toEqual([RAVEN_SERVER])
  })
})
