import { beforeEach, describe, expect, it } from 'bun:test'
import { DEFAULT_THEME, THEMES } from '@raven/core'
import type { StateStorage } from 'zustand/middleware'

import {
  APP_PREFS_KEY,
  AWAY_MAX_HEIGHTS,
  DEFAULT_APP_PREFS,
  configureAppPrefs,
  useAppPrefs,
} from '@/stores/appPrefs'

const memoryStorage = (entries: [string, string][] = []) => {
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

/** The last theme on the list, which is not the default. */
const CONTRAST = THEMES[THEMES.length - 1]?.id ?? DEFAULT_THEME

const prefsOf = () => {
  const { theme, shouldPreferDirectPlay, isTranscodeAllowed, awayMaxHeight } =
    useAppPrefs.getState()
  return { theme, shouldPreferDirectPlay, isTranscodeAllowed, awayMaxHeight }
}

describe('useAppPrefs', () => {
  beforeEach(() => useAppPrefs.setState(DEFAULT_APP_PREFS))

  it('starts on the default theme, preferring direct play, transcoding, and 1080p away', () => {
    expect(prefsOf()).toEqual({
      theme: DEFAULT_THEME,
      shouldPreferDirectPlay: true,
      isTranscodeAllowed: true,
      awayMaxHeight: AWAY_MAX_HEIGHTS.fullHd,
    })
  })

  it('keeps every change across a relaunch', async () => {
    const { storage, items } = memoryStorage()
    await configureAppPrefs({ storage })
    const { change } = useAppPrefs.getState()
    change({ theme: CONTRAST })
    change({ isTranscodeAllowed: false, awayMaxHeight: AWAY_MAX_HEIGHTS.hd })
    change({ shouldPreferDirectPlay: false })

    // What the next launch reads is what this one wrote, before anything there changes it.
    const relaunch = memoryStorage([...items])
    useAppPrefs.setState(DEFAULT_APP_PREFS)
    await configureAppPrefs({ storage: relaunch.storage })
    expect(prefsOf()).toEqual({
      theme: CONTRAST,
      shouldPreferDirectPlay: false,
      isTranscodeAllowed: false,
      awayMaxHeight: AWAY_MAX_HEIGHTS.hd,
    })
  })

  it('falls back to the default for each value it cannot use, and keeps the rest', async () => {
    const saved = {
      state: {
        theme: 'neon',
        shouldPreferDirectPlay: 'no',
        isTranscodeAllowed: false,
        awayMaxHeight: 480,
      },
      version: 0,
    }
    const { storage } = memoryStorage([[APP_PREFS_KEY, JSON.stringify(saved)]])
    await configureAppPrefs({ storage })
    expect(prefsOf()).toEqual({ ...DEFAULT_APP_PREFS, isTranscodeAllowed: false })
  })

  it('starts from the defaults when what it kept is not JSON or not its own', async () => {
    await configureAppPrefs({ storage: memoryStorage([[APP_PREFS_KEY, 'not json']]).storage })
    expect(prefsOf()).toEqual(DEFAULT_APP_PREFS)
    await configureAppPrefs({ storage: memoryStorage([[APP_PREFS_KEY, '{"state":7}']]).storage })
    expect(prefsOf()).toEqual(DEFAULT_APP_PREFS)
  })
})
