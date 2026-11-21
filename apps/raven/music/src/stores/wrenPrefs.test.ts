import { APPEARANCES, RECENT_SORTS, WREN_PREFS_KEY } from '@raven/wren'
import { beforeEach, describe, expect, it } from 'bun:test'
import { AUDIO_BITRATES } from '@raven/core'
import type { StateStorage } from 'zustand/middleware'

import { DEFAULT_WREN_PREFS, configureWrenPrefs, useWrenPrefs } from '@/stores/wrenPrefs'

type MemoryStorageProps = { entries?: [string, string][] }

const memoryStorage = ({ entries = [] }: MemoryStorageProps = {}) => {
  const items = new Map(entries)
  const storage: StateStorage = {
    getItem: (name) => items.get(name) ?? null,
    setItem: (name, value) => {
      items.set(name, value)
    },
    removeItem: (name) => {
      items.delete(name)
    },
  }
  return { storage, items }
}

const prefsOf = () => {
  const { downloadKbps, cellularKbps, storageLimitGb, appearance, homeSort } =
    useWrenPrefs.getState()
  return { downloadKbps, cellularKbps, storageLimitGb, appearance, homeSort }
}

describe('useWrenPrefs', () => {
  beforeEach(() => useWrenPrefs.setState(DEFAULT_WREN_PREFS))

  it('starts downloads at 256 kbps and cellular on the file itself, with no storage limit, following the system appearance', () => {
    expect(prefsOf()).toEqual({
      downloadKbps: AUDIO_BITRATES.standard,
      cellularKbps: null,
      storageLimitGb: null,
      appearance: APPEARANCES.system,
      homeSort: RECENT_SORTS.added,
    })
  })

  it('keeps every change across a relaunch', async () => {
    const { storage, items } = memoryStorage()
    await configureWrenPrefs({ storage })
    useWrenPrefs.getState().change({ downloadKbps: AUDIO_BITRATES.high, cellularKbps: null })
    useWrenPrefs.getState().change({ storageLimitGb: 5, appearance: APPEARANCES.light })
    useWrenPrefs.getState().change({ homeSort: RECENT_SORTS.release })

    const relaunch = memoryStorage({ entries: [...items] })
    useWrenPrefs.setState(DEFAULT_WREN_PREFS)
    await configureWrenPrefs({ storage: relaunch.storage })
    expect(prefsOf()).toEqual({
      downloadKbps: AUDIO_BITRATES.high,
      cellularKbps: null,
      storageLimitGb: 5,
      appearance: APPEARANCES.light,
      homeSort: RECENT_SORTS.release,
    })
  })

  it('falls back to the default for each value it cannot use, and keeps the rest', async () => {
    const saved = {
      state: { downloadKbps: 192, cellularKbps: '128', storageLimitGb: 10, appearance: 'sepia' },
    }
    const { storage } = memoryStorage({ entries: [[WREN_PREFS_KEY, JSON.stringify(saved)]] })
    await configureWrenPrefs({ storage })
    expect(prefsOf()).toEqual({ ...DEFAULT_WREN_PREFS, storageLimitGb: 10 })
  })

  it("moves an older install's cellular transcode to the file itself, keeping its other choices", async () => {
    const saved = {
      state: {
        downloadKbps: AUDIO_BITRATES.high,
        cellularKbps: AUDIO_BITRATES.standard,
        storageLimitGb: 5,
        appearance: APPEARANCES.dark,
      },
      version: 0,
    }
    const { storage } = memoryStorage({ entries: [[WREN_PREFS_KEY, JSON.stringify(saved)]] })
    await configureWrenPrefs({ storage })
    expect(prefsOf()).toEqual({
      downloadKbps: AUDIO_BITRATES.high,
      cellularKbps: null,
      storageLimitGb: 5,
      appearance: APPEARANCES.dark,
      homeSort: RECENT_SORTS.added,
    })
  })

  it('keeps a cellular quality chosen since', async () => {
    const { storage, items } = memoryStorage()
    await configureWrenPrefs({ storage })
    useWrenPrefs.getState().change({ cellularKbps: AUDIO_BITRATES.low })

    const relaunch = memoryStorage({ entries: [...items] })
    useWrenPrefs.setState(DEFAULT_WREN_PREFS)
    await configureWrenPrefs({ storage: relaunch.storage })
    expect(prefsOf().cellularKbps).toBe(AUDIO_BITRATES.low)
  })
})
