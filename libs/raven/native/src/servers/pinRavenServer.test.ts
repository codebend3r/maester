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

/** A server store whose jar records the ids it forgets. */
const storeWithForgetLog = () => {
  const forgotten: string[] = []
  const useServers = createActiveServerStore({
    store: memoryStore().store,
    jar: {
      forget: async (id) => {
        forgotten.push(id)
      },
    },
  })
  return { useServers, forgotten }
}

describe('pinRavenServer', () => {
  it('leaves raven the one server, and the active one, in one change', () => {
    const { useServers, forgotten } = storeWithForgetLog()
    useServers.getState().add(NAS)
    useServers.getState().activate(NAS.id)
    const activeIds: (string | null)[] = []
    useServers.subscribe(({ activeId }) => {
      activeIds.push(activeId)
    })

    pinRavenServer({ servers: useServers })

    expect(useServers.getState()).toMatchObject({
      servers: [RAVEN_SERVER],
      activeId: RAVEN_SERVER.id,
    })
    expect(activeIds).toEqual([RAVEN_SERVER.id])
    expect(forgotten).toEqual([NAS.id])
  })

  it('moves raven stored under an older origin to the current one, keeping its cookies', () => {
    const { useServers, forgotten } = storeWithForgetLog()
    useServers.getState().add({ ...RAVEN_SERVER, origin: 'https://raven-player.netlify.app' })

    pinRavenServer({ servers: useServers })

    expect(useServers.getState()).toMatchObject({
      servers: [RAVEN_SERVER],
      activeId: RAVEN_SERVER.id,
    })
    expect(forgotten).toEqual([])
  })
})
