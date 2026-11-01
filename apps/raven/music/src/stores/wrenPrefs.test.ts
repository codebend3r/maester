import { beforeEach, describe, expect, it } from 'bun:test'
import { AUDIO_BITRATES } from '@raven/core'
import type { StateStorage } from 'zustand/middleware'

import {
  DEFAULT_WREN_PREFS,
  WREN_PREFS_KEY,
  configureWrenPrefs,
  useWrenPrefs,
} from '@/stores/wrenPrefs'

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
  const { downloadKbps, cellularKbps, storageLimitGb } = useWrenPrefs.getState()
  return { downloadKbps, cellularKbps, storageLimitGb }
}

describe('useWrenPrefs', () => {
  beforeEach(() => useWrenPrefs.setState(DEFAULT_WREN_PREFS))

  it('starts with downloads and the cellular stream at 256 kbps, and no storage limit', () => {
    expect(prefsOf()).toEqual({
      downloadKbps: AUDIO_BITRATES.standard,
      cellularKbps: AUDIO_BITRATES.standard,
      storageLimitGb: null,
    })
  })

  it('keeps every change across a relaunch', async () => {
    const { storage, items } = memoryStorage()
    await configureWrenPrefs({ storage })
    useWrenPrefs.getState().change({ downloadKbps: AUDIO_BITRATES.high, cellularKbps: null })
    useWrenPrefs.getState().change({ storageLimitGb: 5 })

    const relaunch = memoryStorage({ entries: [...items] })
    useWrenPrefs.setState(DEFAULT_WREN_PREFS)
    await configureWrenPrefs({ storage: relaunch.storage })
    expect(prefsOf()).toEqual({
      downloadKbps: AUDIO_BITRATES.high,
      cellularKbps: null,
      storageLimitGb: 5,
    })
  })

  it('falls back to the default for each value it cannot use, and keeps the rest', async () => {
    const saved = { state: { downloadKbps: 192, cellularKbps: '128', storageLimitGb: 10 } }
    const { storage } = memoryStorage({ entries: [[WREN_PREFS_KEY, JSON.stringify(saved)]] })
    await configureWrenPrefs({ storage })
    expect(prefsOf()).toEqual({ ...DEFAULT_WREN_PREFS, storageLimitGb: 10 })
  })
})
