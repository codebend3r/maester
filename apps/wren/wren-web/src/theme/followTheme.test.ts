import { describe, expect, it } from 'bun:test'
import { THEME_MODES, WREN_PREFS_KEY, WREN_THEMES } from '@raven/wren'
import { useWrenPrefs } from '@/stores/wrenPrefs'
import { followTheme } from '@/theme/followTheme'

const INDEX_HTML = new URL('../../index.html', import.meta.url)

// happy-dom's device is a light one, so the theme followed here is the light slot's.
describe('followTheme', () => {
  it("wears the theme kept for the device's scheme, and the one theme when one is kept", () => {
    const stop = followTheme()
    expect(document.documentElement.dataset.theme).toBe(WREN_THEMES.paper)

    useWrenPrefs.getState().change({ lightTheme: WREN_THEMES.banana })
    expect(document.documentElement.dataset.theme).toBe(WREN_THEMES.banana)

    useWrenPrefs.getState().change({ darkTheme: WREN_THEMES.ember })
    expect(document.documentElement.dataset.theme).toBe(WREN_THEMES.banana)

    useWrenPrefs.getState().change({ themeMode: THEME_MODES.single, theme: WREN_THEMES.garnet })
    expect(document.documentElement.dataset.theme).toBe(WREN_THEMES.garnet)

    useWrenPrefs.getState().change({ themeMode: THEME_MODES.system })
    expect(document.documentElement.dataset.theme).toBe(WREN_THEMES.banana)
    stop()
  })

  it('stops following when told to', () => {
    followTheme()()
    useWrenPrefs.getState().change({ lightTheme: WREN_THEMES.mint })
    expect(document.documentElement.dataset.theme).toBe(WREN_THEMES.paper)
  })

  it('is read by index.html before first paint, from the same key and under the same names', async () => {
    const page = await Bun.file(INDEX_HTML).text()
    expect(page).toContain(`localStorage.getItem('${WREN_PREFS_KEY}')`)
    expect(page).toContain(`kept.themeMode === '${THEME_MODES.single}'`)
    expect(page).toContain(`kept.themeMode === '${THEME_MODES.system}'`)
    expect(page).toContain(`kept.lightTheme ?? '${WREN_THEMES.paper}'`)
    expect(page).toContain(`kept.darkTheme ?? '${WREN_THEMES.night}'`)
  })
})
