import { KIT_COPY } from '@/copy/kit'
import { SETTINGS_COPY } from '@/copy/screens'
import { type ColorScheme, THEME_MODES, type ThemeChoice, themeFor } from '@/themes'

type ThemeSlotProps = {
  choice: ThemeChoice
  /** The scheme whose theme Settings is picking while Wren matches the device. */
  slot: ColorScheme
}

/** What Settings' theme picker is called: the slot's theme while Wren matches the device, else the one theme. */
export const themePickerLabelOf = ({ choice, slot }: ThemeSlotProps): string =>
  choice.themeMode === THEME_MODES.system ? SETTINGS_COPY.themeFor[slot] : SETTINGS_COPY.theme

/** What a Match device slot is called: its scheme and the theme it wears. */
export const themeSlotLabelOf = ({ choice, slot }: ThemeSlotProps): string =>
  KIT_COPY.labelled({
    label: SETTINGS_COPY.themeSlotNames[slot],
    value: SETTINGS_COPY.themeNames[themeFor({ choice, scheme: slot })],
  })
