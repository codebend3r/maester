import { describe, expect, it } from 'bun:test'
import { configureStorage } from '@/stores/configureStorage'
import { STORE_KEYS } from '@/stores/storage'
import { activeBaseUrl, useActiveServer } from '@/stores/activeServer'
import { MELEYS } from '@/test/fixtures'

describe('useActiveServer', () => {
  it("starts home, on the page's own /api", () => {
    expect(useActiveServer.getState().active).toBeNull()
    expect(activeBaseUrl()).toBe('')
  })

  it("calls the chosen server's origin, and the page's own again once home is chosen", () => {
    useActiveServer.getState().choose(MELEYS)
    expect(activeBaseUrl()).toBe(MELEYS.origin)
    useActiveServer.getState().choose(null)
    expect(activeBaseUrl()).toBe('')
  })

  it('keeps the choice in the storage the host gives it, so a reload stays on that server', async () => {
    await configureStorage({ storage: window.localStorage })
    useActiveServer.getState().choose(MELEYS)
    const kept = window.localStorage.getItem(STORE_KEYS.activeServer) ?? 'null'
    const stored: unknown = JSON.parse(kept)
    expect(stored).toMatchObject({ state: { active: MELEYS } })
    // A new visit: the store starts home, then reads what the last one kept.
    useActiveServer.setState({ active: null })
    window.localStorage.setItem(STORE_KEYS.activeServer, kept)
    await useActiveServer.persist.rehydrate()
    expect(useActiveServer.getState().active).toEqual(MELEYS)
  })

  it('goes home when what is stored is not a server it could have kept', async () => {
    await configureStorage({ storage: window.localStorage })
    window.localStorage.setItem(
      STORE_KEYS.activeServer,
      JSON.stringify({ state: { active: { serverId: 'nope', origin: 'ftp://x' } }, version: 0 }),
    )
    await useActiveServer.persist.rehydrate()
    expect(useActiveServer.getState().active).toBeNull()
  })
})
