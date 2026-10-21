import { beforeEach, describe, expect, it } from 'bun:test'
import { DEFAULT_THEME, THEMES, THEME_TONES } from '@raven/core'
import type { StateStorage } from 'zustand/middleware'

import { APP_PREFS_KEY, DEFAULT_APP_PREFS, configureAppPrefs, useAppPrefs } from '@/stores/appPrefs'
import { type AppTheme, appThemeOf } from '@/theme/appTheme'
import { followTheme } from '@/theme/useTheme'

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

const PATINA = THEMES.find((theme) => theme.name === 'Patina')?.id ?? DEFAULT_THEME
const BRONZE = THEMES.find((theme) => theme.name === 'Bronze')?.id ?? DEFAULT_THEME

/** Follows the theme into a list, the way the app follows it into the system's UI. */
const follow = () => {
  const worn: AppTheme[] = []
  const stop = followTheme({ apply: (theme) => worn.push(theme) })
  return { worn, stop }
}

describe('followTheme', () => {
  beforeEach(() => useAppPrefs.setState(DEFAULT_APP_PREFS))

  it('wears the default theme on a fresh install, with the dark logo', () => {
    const { worn, stop } = follow()
    expect(worn).toEqual([appThemeOf(DEFAULT_THEME)])
    expect(worn[0]?.tone ?? null).toBe(THEME_TONES.dark)
    stop()
  })

  it("wears Patina the moment it is picked: the light logo and Patina's night", () => {
    const { worn, stop } = follow()
    useAppPrefs.getState().change({ theme: PATINA })
    const last = worn.at(-1) ?? null
    expect(last?.id ?? null).toBe(PATINA)
    expect(last?.tone ?? null).toBe(THEME_TONES.light)
    expect(last?.palette.ground ?? null).toBe(appThemeOf(PATINA).palette.ground)
    stop()
  })

  it('wears nothing again for a change that leaves the theme as it was, and nothing once stopped', () => {
    const { worn, stop } = follow()
    useAppPrefs.getState().change({ isTranscodeAllowed: false })
    expect(worn).toHaveLength(1)
    stop()
    useAppPrefs.getState().change({ theme: BRONZE })
    expect(worn).toHaveLength(1)
  })

  it('wears the theme picked before a relaunch from the first frame after it', async () => {
    const { storage, items } = memoryStorage()
    await configureAppPrefs({ storage })
    useAppPrefs.getState().change({ theme: PATINA })

    const relaunch = memoryStorage([...items])
    useAppPrefs.setState(DEFAULT_APP_PREFS)
    await configureAppPrefs({ storage: relaunch.storage })
    const { worn, stop } = follow()
    expect(worn).toEqual([appThemeOf(PATINA)])
    stop()
  })

  it('wears the default theme when the stored one is no theme', async () => {
    const saved = JSON.stringify({ state: { theme: 'neon' }, version: 0 })
    await configureAppPrefs({ storage: memoryStorage([[APP_PREFS_KEY, saved]]).storage })
    const { worn, stop } = follow()
    expect(worn).toEqual([appThemeOf(DEFAULT_THEME)])
    stop()
  })

  it('wears the default theme when what was stored cannot be read at all', async () => {
    await configureAppPrefs({ storage: memoryStorage([[APP_PREFS_KEY, '{not json']]).storage })
    const { worn, stop } = follow()
    expect(worn).toEqual([appThemeOf(DEFAULT_THEME)])
    stop()
  })
})
