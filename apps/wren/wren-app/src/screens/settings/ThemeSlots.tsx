import {
  COLOR_SCHEMES,
  type ColorScheme,
  SETTINGS_COPY,
  type ThemeChoice,
  themeFor,
  themeSlotLabelOf,
  type Palette,
  WREN_PALETTES,
} from '@raven/wren'
import { Pressable, Text, View } from 'react-native'

import { type WrenTheme, themedStyles, useSystemScheme } from '@/theme/wrenTheme'
import { RADIUS, SIZE, SPACE, THEME_SIZES, TYPE } from '@/theme/wrenTokens'
import { pressedStyleOf } from '@/ui/press'

const SLOTS = [COLOR_SCHEMES.light, COLOR_SCHEMES.dark] as const

/** The three colours a slot shows of its theme, by their place in the palette. */
const SLOT_DOTS = ['bg', 'surface2', 'accent'] as const satisfies readonly (keyof Palette)[]

const useStyles = themedStyles(({ colors }: WrenTheme) => ({
  slots: { flexDirection: 'row', gap: SPACE.s2 },
  slot: {
    borderColor: colors.line2,
    borderRadius: RADIUS.md,
    borderWidth: SIZE.hairline,
    flex: 1,
    gap: SPACE.s2,
    padding: SPACE.s3,
  },
  // The ring thickens inward, as the web's inset one does, so the words never shift.
  picked: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accentText,
    borderWidth: SIZE.focusRing,
    padding: SPACE.s3 - (SIZE.focusRing - SIZE.hairline),
  },
  when: { ...TYPE.meta, color: colors.text2 },
  theme: { alignItems: 'center', flexDirection: 'row', gap: SPACE.s2 },
  dots: { flexDirection: 'row', gap: SPACE.s1 },
  dot: {
    borderRadius: RADIUS.pill,
    borderWidth: SIZE.hairline,
    height: THEME_SIZES.dot,
    width: THEME_SIZES.dot,
  },
  name: { ...TYPE.rowStrong, color: colors.text, flex: 1 },
  now: { ...TYPE.metaStrong, color: colors.accentText },
}))

type ThemeSlotProps = {
  choice: ThemeChoice
  /** The device's scheme this slot holds the theme for. */
  scheme: ColorScheme
  isPicked: boolean
  /** Whether the device is in this slot's scheme, so its theme is the one showing. */
  isShowing: boolean
  onPress: () => void
}

/** One slot: when it shows, its theme in three of that theme's colours and its name, and whether it is showing now. */
function ThemeSlot({ choice, scheme, isPicked, isShowing, onPress }: ThemeSlotProps) {
  const styles = useStyles()
  const theme = themeFor({ choice, scheme })
  const palette = WREN_PALETTES[theme]
  return (
    <Pressable
      accessibilityLabel={themeSlotLabelOf({ choice, slot: scheme })}
      accessibilityRole="radio"
      accessibilityState={{ checked: isPicked }}
      onPress={onPress}
      style={pressedStyleOf({ style: [styles.slot, isPicked && styles.picked] })}
    >
      <Text numberOfLines={1} style={styles.when}>
        {SETTINGS_COPY.themeSlotNames[scheme]}
      </Text>
      <View style={styles.theme}>
        <View style={styles.dots}>
          {SLOT_DOTS.map((dot) => (
            <View
              key={dot}
              style={[styles.dot, { backgroundColor: palette[dot], borderColor: palette.line2 }]}
            />
          ))}
        </View>
        <Text numberOfLines={1} style={styles.name}>
          {SETTINGS_COPY.themeNames[theme]}
        </Text>
      </View>
      {isShowing && (
        <Text numberOfLines={1} style={styles.now}>
          {SETTINGS_COPY.showingNow}
        </Text>
      )}
    </Pressable>
  )
}

type ThemeSlotsProps = {
  choice: ThemeChoice
  /** The slot whose theme the picker under it sets. */
  slot: ColorScheme
  onSelect: (slot: ColorScheme) => void
}

/**
 * The two themes of the Match device mode, one for each of the device's schemes: each slot
 * shows its theme in three of that theme's colours and, for the scheme the device is in, that
 * it is the one showing. Picking a slot hands it to the theme picker.
 */
export function ThemeSlots({ choice, slot, onSelect }: ThemeSlotsProps) {
  const styles = useStyles()
  const system = useSystemScheme()
  return (
    <View
      accessibilityLabel={SETTINGS_COPY.themeSlots}
      accessibilityRole="radiogroup"
      style={styles.slots}
    >
      {SLOTS.map((scheme) => (
        <ThemeSlot
          choice={choice}
          isPicked={scheme === slot}
          isShowing={scheme === system}
          key={scheme}
          onPress={() => onSelect(scheme)}
          scheme={scheme}
        />
      ))}
    </View>
  )
}
