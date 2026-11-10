import { beforeEach, describe, expect, it } from 'bun:test'
import { DEFAULT_THEME, MAX_HEIGHTS, THEMES } from '@raven/core'
import type { StateStorage } from 'zustand/middleware'

import {
  APP_PREFS_KEY,
  DEFAULT_APP_PREFS,
  DOWNLOAD_GROUPINGS,
  GRID_SIZES,
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
  const {
    theme,
    shouldPreferDirectPlay,
    isTranscodeAllowed,
    awayMaxHeight,
    gridSize,
    isEqualizerShown,
    downloadsGrouping,
  } = useAppPrefs.getState()
  return {
    theme,
    shouldPreferDirectPlay,
    isTranscodeAllowed,
    awayMaxHeight,
    gridSize,
    isEqualizerShown,
    downloadsGrouping,
  }
}

describe('useAppPrefs', () => {
  beforeEach(() => useAppPrefs.setState(DEFAULT_APP_PREFS))

  it('starts on the default theme, preferring direct play, transcoding, 1080p away, medium grids and every download in one list', () => {
    expect(prefsOf()).toEqual({
      theme: DEFAULT_THEME,
      shouldPreferDirectPlay: true,
      isTranscodeAllowed: true,
      awayMaxHeight: MAX_HEIGHTS.fullHd,
      gridSize: GRID_SIZES.medium,
      isEqualizerShown: true,
      downloadsGrouping: DOWNLOAD_GROUPINGS.all,
    })
  })

  it('keeps every change across a relaunch', async () => {
    const { storage, items } = memoryStorage()
    await configureAppPrefs({ storage })
    const { change } = useAppPrefs.getState()
    change({ theme: CONTRAST })
    change({ isTranscodeAllowed: false, awayMaxHeight: MAX_HEIGHTS.hd })
    change({ shouldPreferDirectPlay: false })
    change({ gridSize: GRID_SIZES.large, isEqualizerShown: false })
    change({ downloadsGrouping: DOWNLOAD_GROUPINGS.byLibrary })

    // What the next launch reads is what this one wrote, before anything there changes it.
    const relaunch = memoryStorage([...items])
    useAppPrefs.setState(DEFAULT_APP_PREFS)
    await configureAppPrefs({ storage: relaunch.storage })
    expect(prefsOf()).toEqual({
      theme: CONTRAST,
      shouldPreferDirectPlay: false,
      isTranscodeAllowed: false,
      awayMaxHeight: MAX_HEIGHTS.hd,
      gridSize: GRID_SIZES.large,
      isEqualizerShown: false,
      downloadsGrouping: DOWNLOAD_GROUPINGS.byLibrary,
    })
  })

  it('falls back to the default for each value it cannot use, and keeps the rest', async () => {
    const saved = {
      state: {
        theme: 'neon',
        shouldPreferDirectPlay: 'no',
        isTranscodeAllowed: false,
        awayMaxHeight: 480,
        gridSize: 'huge',
        isEqualizerShown: 'yes',
        downloadsGrouping: 'byShelf',
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
