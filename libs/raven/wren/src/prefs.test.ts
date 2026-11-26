import { describe, expect, it } from 'bun:test'

import { COVER_SIZES, DEFAULT_SHARED_PREFS, RECENT_SORTS, sharedPrefsOf } from '@/prefs'
import { THEME_MODES, WREN_THEMES } from '@/themes'

describe('sharedPrefsOf', () => {
  it('starts a first run on the defaults', () => {
    expect(sharedPrefsOf(null)).toEqual(DEFAULT_SHARED_PREFS)
  })

  it('keeps each choice that is one', () => {
    const kept = sharedPrefsOf({
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

  it("reads a phone build's prefs, leaving what the TV and the web have no use for", () => {
    const kept = sharedPrefsOf({ downloadKbps: 256, cellularKbps: 128, coverSize: 'nonsense' })
    expect(kept).toEqual(DEFAULT_SHARED_PREFS)
    expect(Object.keys(kept)).not.toContain('downloadKbps')
  })
})
