import { describe, expect, it } from 'bun:test'

import { KIT_COPY } from '@/copy/kit'
import { SETTINGS_COPY } from '@/copy/screens'
import { themePickerLabelOf, themeSlotLabelOf } from '@/themePickerLabel'
import { COLOR_SCHEMES, DEFAULT_THEME_CHOICE, THEME_MODES } from '@/themes'

describe('themePickerLabelOf', () => {
  it("names the slot's theme while Wren matches the device", () => {
    expect(themePickerLabelOf({ choice: DEFAULT_THEME_CHOICE, slot: COLOR_SCHEMES.dark })).toBe(
      SETTINGS_COPY.themeFor[COLOR_SCHEMES.dark],
    )
  })

  it('names the one theme whatever the slot', () => {
    const choice = { ...DEFAULT_THEME_CHOICE, themeMode: THEME_MODES.single }
    expect(themePickerLabelOf({ choice, slot: COLOR_SCHEMES.light })).toBe(SETTINGS_COPY.theme)
  })
})

describe('themeSlotLabelOf', () => {
  it('names the slot by its scheme and the theme it wears', () => {
    const choice = { ...DEFAULT_THEME_CHOICE, themeMode: THEME_MODES.system }
    expect(themeSlotLabelOf({ choice, slot: COLOR_SCHEMES.dark })).toBe(
      KIT_COPY.labelled({
        label: SETTINGS_COPY.themeSlotNames[COLOR_SCHEMES.dark],
        value: SETTINGS_COPY.themeNames[choice.darkTheme],
      }),
    )
  })
})
