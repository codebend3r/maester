import { afterAll, describe, expect, test } from 'bun:test'
import type { StateStorage } from 'zustand/middleware'
import { configureStorage } from '@/stores/configureStorage'
import { AUDIOBOOK_SPEEDS, PLAYER_PREFS_KEY, usePlayerPrefs } from '@/stores/playerPrefs'

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

describe('the audiobook speed', () => {
  afterAll(() => usePlayerPrefs.getState().setAudiobookSpeed(1))

  test('takes an offered speed as it is, and the nearest offered one for any other', () => {
    usePlayerPrefs.getState().setAudiobookSpeed(1.5)
    expect(usePlayerPrefs.getState().audiobookSpeed).toBe(1.5)
    usePlayerPrefs.getState().setAudiobookSpeed(3)
    expect(usePlayerPrefs.getState().audiobookSpeed).toBe(2)
    usePlayerPrefs.getState().setAudiobookSpeed(0.1)
    expect(usePlayerPrefs.getState().audiobookSpeed).toBe(0.75)
    usePlayerPrefs.getState().setAudiobookSpeed(1.3)
    expect(usePlayerPrefs.getState().audiobookSpeed).toBe(1.25)
  })

  test('offers 0.75 to 2 in quarters', () => {
    expect(AUDIOBOOK_SPEEDS).toEqual([0.75, 1, 1.25, 1.5, 1.75, 2])
  })
})
