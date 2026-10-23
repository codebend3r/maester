import { afterAll, describe, expect, test } from 'bun:test'
import type { StateStorage } from 'zustand/middleware'
import { configureStorage } from '@/stores/configureStorage'
import { PLAYER_PREFS_KEY, usePlayerPrefs } from '@/stores/playerPrefs'

const mapStorage = (entries: Map<string, string>): StateStorage => ({
  getItem: (name) => entries.get(name) ?? null,
  setItem: (name, value) => {
    entries.set(name, value)
  },
  removeItem: (name) => {
    entries.delete(name)
  },
})

describe('configureStorage', () => {
  // The store is shared by every test file in the run; leave it on localStorage.
  afterAll(() => configureStorage({ storage: window.localStorage }))

  test('hydrates the prefs from the storage it is given', async () => {
    const version = usePlayerPrefs.persist.getOptions().version ?? 0
    const entries = new Map([
      [PLAYER_PREFS_KEY, JSON.stringify({ state: { volume: 0.4 }, version })],
    ])

    await configureStorage({ storage: mapStorage(entries) })

    expect(usePlayerPrefs.getState().volume).toBe(0.4)
  })

  test('writes later changes into that storage', async () => {
    const entries = new Map<string, string>()
    await configureStorage({ storage: mapStorage(entries) })

    usePlayerPrefs.getState().setVolume({ volume: 0.7, muted: false })

    expect(entries.get(PLAYER_PREFS_KEY)).toContain('"volume":0.7')
  })
})
