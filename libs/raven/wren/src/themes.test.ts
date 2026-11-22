import { describe, expect, it } from 'bun:test'
import {
  COLOR_SCHEMES,
  DEFAULT_THEME_CHOICE,
  THEME_MODES,
  THEME_SCHEMES,
  WREN_THEMES,
  systemSchemeOf,
  themeChoiceIn,
  themeChoiceOf,
  themeFor,
  withThemePicked,
} from '@/themes'

const SYSTEM = {
  ...DEFAULT_THEME_CHOICE,
  lightTheme: WREN_THEMES.banana,
  darkTheme: WREN_THEMES.midnight,
}

const SINGLE = { ...SYSTEM, themeMode: THEME_MODES.single, theme: WREN_THEMES.garnet }

describe('themeChoiceOf', () => {
  it('starts on Paper and Night, following the device', () => {
    expect(themeChoiceOf(undefined)).toEqual({
      themeMode: THEME_MODES.system,
      theme: WREN_THEMES.night,
      lightTheme: WREN_THEMES.paper,
      darkTheme: WREN_THEMES.night,
    })
  })

  it('reads back what was kept', () => {
    expect(themeChoiceOf(SINGLE)).toEqual(SINGLE)
  })

  it('guards each part on its own', () => {
    expect(themeChoiceOf({ ...SINGLE, themeMode: 'both', lightTheme: 'sepia' })).toEqual({
      ...SINGLE,
      themeMode: THEME_MODES.system,
      lightTheme: WREN_THEMES.paper,
    })
  })

  it("reads an older Wren's Light and Dark as the one theme of that scheme", () => {
    expect(themeChoiceOf({ appearance: 'light' })).toMatchObject({
      themeMode: THEME_MODES.single,
      theme: WREN_THEMES.paper,
    })
    expect(themeChoiceOf({ appearance: 'dark' })).toMatchObject({
      themeMode: THEME_MODES.single,
      theme: WREN_THEMES.night,
    })
  })

  it("reads an older Wren's System as following the device", () => {
    expect(themeChoiceOf({ appearance: 'system' })).toEqual(DEFAULT_THEME_CHOICE)
  })

  it('prefers the mode kept now to an older appearance', () => {
    expect(themeChoiceOf({ ...SYSTEM, appearance: 'light' })).toEqual(SYSTEM)
  })
})

describe('themeFor', () => {
  it("is the theme kept for a scheme, the device's or a slot's", () => {
    expect(themeFor({ choice: SYSTEM, scheme: COLOR_SCHEMES.light })).toBe(WREN_THEMES.banana)
    expect(themeFor({ choice: SYSTEM, scheme: COLOR_SCHEMES.dark })).toBe(WREN_THEMES.midnight)
  })

  it('is the one theme whatever the scheme', () => {
    expect(themeFor({ choice: SINGLE, scheme: COLOR_SCHEMES.light })).toBe(WREN_THEMES.garnet)
    expect(themeFor({ choice: SINGLE, scheme: COLOR_SCHEMES.dark })).toBe(WREN_THEMES.garnet)
  })
})

describe('themeChoiceIn', () => {
  it('leaves out whatever else a store keeps beside the choice', () => {
    const kept = { ...SINGLE, homeSort: 'added' }
    expect(themeChoiceIn(kept)).toEqual(SINGLE)
  })
})

describe('systemSchemeOf', () => {
  it('is dark unless the device says light', () => {
    expect(systemSchemeOf('light')).toBe(COLOR_SCHEMES.light)
    expect(systemSchemeOf('dark')).toBe(COLOR_SCHEMES.dark)
    expect(systemSchemeOf(null)).toBe(COLOR_SCHEMES.dark)
  })
})

describe("Settings' picker", () => {
  it("changes the slot's theme while following the device", () => {
    expect(
      withThemePicked({ choice: SYSTEM, scheme: COLOR_SCHEMES.dark, theme: WREN_THEMES.ember }),
    ).toEqual({ darkTheme: WREN_THEMES.ember })
    expect(
      withThemePicked({ choice: SYSTEM, scheme: COLOR_SCHEMES.light, theme: WREN_THEMES.mint }),
    ).toEqual({ lightTheme: WREN_THEMES.mint })
  })

  it('changes the one theme otherwise', () => {
    expect(
      withThemePicked({ choice: SINGLE, scheme: COLOR_SCHEMES.light, theme: WREN_THEMES.blush }),
    ).toEqual({ theme: WREN_THEMES.blush })
  })
})

describe('THEME_SCHEMES', () => {
  it('gives every theme a scheme', () => {
    expect(Object.keys(THEME_SCHEMES).toSorted()).toEqual(Object.values(WREN_THEMES).toSorted())
  })
})
