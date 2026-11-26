import { WREN_ICONS } from '@raven/wren'
import {
  type ColorScheme,
  COLOR_SCHEMES,
  SETTINGS_COPY,
  THEME_MODES,
  THEME_SCHEMES,
  WREN_THEMES,
  factsLineOf,
  themeFor,
  themePickerLabelOf,
  themeSlotLabelOf,
  withThemePicked,
} from '@raven/wren'
import { useState } from 'react'
import { Text } from 'react-native'

import { SettingsGroup } from '@/screens/settings/parts'
import { useThemeChoice, useWrenPrefs } from '@/stores/wrenPrefs'
import { SPACE, TYPE } from '@/theme/tvTokens'
import { themedStyles, useSystemScheme } from '@/theme/wrenTheme'
import { CHOICE_LOOKS, ChoiceButton } from '@/ui/ChoiceButton'
import { ChoiceRow } from '@/ui/ChoiceRow'

const MODES = [THEME_MODES.system, THEME_MODES.single] as const

const SLOTS = [COLOR_SCHEMES.light, COLOR_SCHEMES.dark] as const

const THEME_NAMES = Object.values(WREN_THEMES)

const useStyles = themedStyles(({ colors }) => ({
  note: { ...TYPE.meta, color: colors.text2, paddingHorizontal: SPACE.s1 },
}))

/**
 * The theme Wren wears: one for each of the TV's schemes, switched as the TV goes light or dark,
 * or one whatever the TV says. In the first mode a slot is picked, which starts on the slot
 * showing; the theme row under it opens every theme to pick from, as radio choices in a sheet.
 */
export function AppearanceGroup() {
  const styles = useStyles()
  const choice = useThemeChoice()
  const change = useWrenPrefs((state) => state.change)
  const system = useSystemScheme()
  const [slot, setSlot] = useState<ColorScheme>(system)
  const isFollowing = choice.themeMode === THEME_MODES.system
  const pickerLabel = themePickerLabelOf({ choice, slot })
  const worn = themeFor({ choice, scheme: slot })
  return (
    <SettingsGroup heading={SETTINGS_COPY.appearance}>
      <ChoiceRow
        choices={MODES.map((mode) => ({ key: mode, label: SETTINGS_COPY.themeModes[mode] }))}
        label={SETTINGS_COPY.themeMode}
        onSelect={(themeMode) => change({ themeMode })}
        selected={choice.themeMode}
      />
      <Text style={styles.note}>{SETTINGS_COPY.themeModeNotes[choice.themeMode]}</Text>
      {isFollowing && (
        <ChoiceRow
          choices={SLOTS.map((scheme) => ({
            key: scheme,
            label: themeSlotLabelOf({ choice, slot: scheme }),
            text: factsLineOf([
              SETTINGS_COPY.themeSlotNames[scheme],
              scheme === system ? SETTINGS_COPY.showingNow : null,
            ]),
          }))}
          label={SETTINGS_COPY.themeSlots}
          onSelect={setSlot}
          selected={slot}
        />
      )}
      <ChoiceButton
        chosen={worn}
        icon={WREN_ICONS.grid}
        look={CHOICE_LOOKS.row}
        onChoose={(theme) => change(withThemePicked({ choice, scheme: slot, theme }))}
        options={THEME_NAMES.map((theme) => ({
          value: theme,
          label: SETTINGS_COPY.themeNames[theme],
          line: SETTINGS_COPY.schemeNames[THEME_SCHEMES[theme]],
        }))}
        title={pickerLabel}
      />
    </SettingsGroup>
  )
}
