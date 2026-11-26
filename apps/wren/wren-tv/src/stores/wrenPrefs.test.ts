import { describe, expect, it } from 'bun:test'

import { COVER_SIZES, RECENT_SORTS, THEME_MODES, WREN_THEMES } from '@raven/wren'

import { DEFAULT_WREN_PREFS, wrenPrefsOf } from '@/stores/wrenPrefs'

describe('wrenPrefsOf', () => {
  it('starts a first run on the defaults', () => {
    expect(wrenPrefsOf(null)).toEqual(DEFAULT_WREN_PREFS)
  })

  it('keeps each choice that is one', () => {
    const kept = wrenPrefsOf({
      themeMode: THEME_MODES.single,
      theme: WREN_THEMES.ember,
      homeSort: RECENT_SORTS.release,
      coverSize: COVER_SIZES.large,
      libraryId: 4,
    })
    expect(kept.theme).toBe(WREN_THEMES.ember)
    expect(kept.homeSort).toBe(RECENT_SORTS.release)
    expect(kept.coverSize).toBe(COVER_SIZES.large)
    expect(kept.libraryId).toBe(4)
  })

  it("reads a phone build's prefs, leaving what a TV has no use for", () => {
    const kept = wrenPrefsOf({ downloadKbps: 256, cellularKbps: 128, coverSize: 'nonsense' })
    expect(kept).toEqual(DEFAULT_WREN_PREFS)
    expect(Object.keys(kept)).not.toContain('downloadKbps')
  })
})
