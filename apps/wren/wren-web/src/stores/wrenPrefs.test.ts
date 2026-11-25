import { describe, expect, it } from 'bun:test'
import { RECENT_SORTS, THEME_MODES, WREN_PREFS_KEY, WREN_THEMES } from '@raven/wren'
import { DEFAULT_WREN_PREFS, useWrenPrefs } from '@/stores/wrenPrefs'

const keep = (state: unknown): void =>
  window.localStorage.setItem(WREN_PREFS_KEY, JSON.stringify({ state, version: 1 }))

const kept = (): unknown => JSON.parse(window.localStorage.getItem(WREN_PREFS_KEY) ?? 'null')

describe('useWrenPrefs', () => {
  it("starts on Paper and Night by the device's scheme, and Home's albums by when they were added", () => {
    expect(useWrenPrefs.getState()).toMatchObject({
      themeMode: THEME_MODES.system,
      lightTheme: WREN_THEMES.paper,
      darkTheme: WREN_THEMES.night,
      homeSort: RECENT_SORTS.added,
    })
  })

  it('keeps a change in this browser, under the key the apps use', () => {
    useWrenPrefs.getState().change({ lightTheme: WREN_THEMES.banana })

    expect(kept()).toMatchObject({
      state: { lightTheme: WREN_THEMES.banana, homeSort: RECENT_SORTS.added },
    })
  })

  it('reads back what it kept', async () => {
    keep({
      themeMode: THEME_MODES.single,
      theme: WREN_THEMES.garnet,
      homeSort: RECENT_SORTS.release,
    })
    await useWrenPrefs.persist.rehydrate()

    expect(useWrenPrefs.getState()).toMatchObject({
      themeMode: THEME_MODES.single,
      theme: WREN_THEMES.garnet,
      homeSort: RECENT_SORTS.release,
    })
  })

  it("reads an older Wren's Dark as Night alone", async () => {
    keep({ appearance: 'dark', homeSort: RECENT_SORTS.release })
    await useWrenPrefs.persist.rehydrate()

    expect(useWrenPrefs.getState()).toMatchObject({
      themeMode: THEME_MODES.single,
      theme: WREN_THEMES.night,
    })
    expect(useWrenPrefs.getState()).not.toHaveProperty('appearance')
  })

  it('guards each preference on its own, so one it does not know leaves the others kept', async () => {
    keep({ theme: 'sepia', homeSort: RECENT_SORTS.release, downloadKbps: 320 })
    await useWrenPrefs.persist.rehydrate()

    expect(useWrenPrefs.getState()).toMatchObject({
      theme: DEFAULT_WREN_PREFS.theme,
      homeSort: RECENT_SORTS.release,
    })
    expect(useWrenPrefs.getState()).not.toHaveProperty('downloadKbps')
  })

  it('starts fresh from a value that is no object at all', async () => {
    window.localStorage.setItem(WREN_PREFS_KEY, '"nonsense"')
    await useWrenPrefs.persist.rehydrate()

    expect(useWrenPrefs.getState()).toMatchObject(DEFAULT_WREN_PREFS)
  })
})
