import { describe, expect, it } from 'bun:test'
import {
  ADMIN_LOCK_STATES,
  type AdminLock,
  ApiError,
  type Home,
  type LockState,
  SERVERS_CAP,
} from '@raven/core'

import {
  FINISH_OUTCOMES,
  SIGN_IN_STEPS,
  finishSignIn,
  stepAfterAccount,
  stepAfterSecret,
} from '@/account/signInSteps'
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

type ApiOfProps = {
  lock?: LockState
  adminLock?: AdminLock
  ticket?: () => Promise<{ ticket: string; expiresAt: number }>
}

/** A fake server that records the secrets it was sent. */
const apiOf = ({
  lock = { available: false, unlocked: false },
  adminLock = { state: ADMIN_LOCK_STATES.off },
  ticket = async () => ({ ticket: 't', expiresAt: 1 }),
}: ApiOfProps = {}) => {
  const sent: string[] = []
  return {
    sent,
    api: {
      getLock: async () => lock,
      unlock: async (pin: string) => {
        sent.push(`pin:${pin}`)
        return { available: true, unlocked: true }
      },
      getAdminLock: async () => adminLock,
      unlockAdmin: async (password: string): Promise<AdminLock> => {
        sent.push(`admin:${password}`)
        return { state: ADMIN_LOCK_STATES.off }
      },
      getHome: async () => HOME,
      getMediaTicket: ticket,
    },
  }
}

const serversOf = () =>
  createActiveServerStore({ store: memoryStore().store, jar: { forget: async () => {} } })

describe('stepAfterAccount', () => {
  it('asks for the PIN when the server has one the account has not given', async () => {
    const { api } = apiOf({ lock: { available: true, unlocked: false } })
    expect(await stepAfterAccount({ api, server: SERVER })).toEqual({
      kind: SIGN_IN_STEPS.pin,
      server: SERVER,
    })
  })

  it.each([
    ['has no PIN', { available: false, unlocked: false }],
    ['is unlocked already', { available: true, unlocked: true }],
  ])('asks nothing more when the server %s', async (_name, lock: LockState) => {
    expect(await stepAfterAccount({ api: apiOf({ lock }).api, server: SERVER })).toBeNull()
  })
})

describe('stepAfterSecret', () => {
  it('sends the PIN, then asks for the admin password while the admin lock holds', async () => {
    const { api, sent } = apiOf({
      adminLock: { state: ADMIN_LOCK_STATES.on, available: true },
    })
    const step = { kind: SIGN_IN_STEPS.pin, server: SERVER }
    expect(await stepAfterSecret({ api, step, secret: '1357' })).toEqual({
      kind: SIGN_IN_STEPS.admin,
      server: SERVER,
    })
    expect(sent).toEqual(['pin:1357'])
  })

  it.each([
    ['off', { state: ADMIN_LOCK_STATES.off }],
    ['on with no password set', { state: ADMIN_LOCK_STATES.on, available: false }],
  ])('is done after the PIN when the admin lock is %s', async (_name, adminLock: AdminLock) => {
    const step = { kind: SIGN_IN_STEPS.pin, server: SERVER }
    expect(await stepAfterSecret({ api: apiOf({ adminLock }).api, step, secret: '1' })).toBeNull()
  })

  it('sends the admin password and is done', async () => {
    const { api, sent } = apiOf({ adminLock: { state: ADMIN_LOCK_STATES.on, available: true } })
    const step = { kind: SIGN_IN_STEPS.admin, server: SERVER }
    expect(await stepAfterSecret({ api, step, secret: 'Pass#word2026' })).toBeNull()
    expect(sent).toEqual(['admin:Pass#word2026'])
  })
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
    expect(useServers.getState()).toMatchObject({ servers: [SERVER], activeId: SERVER.id })
  })

  it('keeps a server it knows as it is', async () => {
    const useServers = serversOf()
    useServers.getState().add(SERVER)
    await finishSignIn({ servers: useServers, server: SERVER, api: apiOf().api })
    expect(useServers.getState().servers).toEqual([SERVER])
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
    expect(useServers.getState().activeId).toBeNull()
  })
})
