import { describe, expect, it } from 'bun:test'
import { ApiError, type Home, SERVERS_CAP } from '@raven/core'

import { FINISH_OUTCOMES, finishSignIn } from '@/account/signInSteps'
import { createActiveServerStore } from '@/servers/activeServerStore'
import type { AppServer } from '@/servers/serverList'
import { mediaItemFor } from '@/test/mediaItem'
import { memoryStore } from '@/test/memoryStore'

const SERVER: AppServer = {
  id: '0f8fad5b-d9cb-469f-a165-70867728950e',
  name: 'raven',
  origin: 'http://nas:8080',
  addedAt: 1,
}

const HOME: Home = { inProgress: [{ media: mediaItemFor({ id: 7 }), poster: null }], shelves: [] }

type ApiOfProps = { ticket?: () => Promise<{ ticket: string; expiresAt: number }> }

const apiOf = ({ ticket = async () => ({ ticket: 't', expiresAt: 1 }) }: ApiOfProps = {}) => ({
  api: { getHome: async () => HOME, getMediaTicket: ticket },
})

const BUILT_IN: AppServer = {
  id: '7c1f4e2a-3b5d-4a6e-8f90-1a2b3c4d5e6f',
  name: 'home',
  origin: 'https://home.example',
  addedAt: 0,
}

const serversOf = () =>
  createActiveServerStore({
    store: memoryStore().store,
    jar: { forget: async () => {} },
    home: BUILT_IN,
  })

describe('finishSignIn', () => {
  it('adds the server, makes it the active one and is done', async () => {
    const useServers = serversOf()
    const outcome = await finishSignIn({
      servers: useServers,
      server: SERVER,
      api: apiOf().api,
    })
    expect(outcome).toBe(FINISH_OUTCOMES.done)
    expect(useServers.getState()).toMatchObject({
      servers: [BUILT_IN, SERVER],
      activeId: SERVER.id,
    })
  })

  it('keeps a server it knows as it is', async () => {
    const useServers = serversOf()
    useServers.getState().add(SERVER)
    await finishSignIn({ servers: useServers, server: SERVER, api: apiOf().api })
    expect(useServers.getState().servers).toEqual([BUILT_IN, SERVER])
  })

  it('says so when the server hands out no tickets, with the server active', async () => {
    const useServers = serversOf()
    const outcome = await finishSignIn({
      servers: useServers,
      server: SERVER,
      api: apiOf({
        ticket: async () => {
          throw new ApiError({ status: 503, message: 'no secret' })
        },
      }).api,
    })
    expect(outcome).toBe(FINISH_OUTCOMES.ticketsOff)
    expect(useServers.getState().activeId).toBe(SERVER.id)
  })

  it('says so when the device keeps as many servers as it can', async () => {
    const useServers = serversOf()
    Array.from({ length: SERVERS_CAP }, (_, n) => ({
      ...SERVER,
      id: `7c9e6679-7425-40de-944b-${String(n).padStart(12, '0')}`,
      origin: `http://nas${n}:8080`,
    })).forEach((server) => useServers.getState().add(server))
    const outcome = await finishSignIn({
      servers: useServers,
      server: SERVER,
      api: apiOf().api,
    })
    expect(outcome).toBe(FINISH_OUTCOMES.full)
    expect(useServers.getState().activeId).toBe(BUILT_IN.id)
  })
})
