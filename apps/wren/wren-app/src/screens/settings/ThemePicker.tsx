import {
  SETTINGS_COPY,
  THEME_SCHEMES,
  WREN_PALETTES,
  WREN_THEMES,
  type WrenThemeName,
} from '@raven/wren'
import { Pressable, Text, View } from 'react-native'

import { type WrenTheme, themedStyles, useWrenTheme } from '@/theme/wrenTheme'
import { FORM_FACTORS, RADIUS, SIZE, SPACE, THEME_SIZES, TYPE } from '@/theme/wrenTokens'
import { pressedStyleOf } from '@/ui/press'
import { UNSEEN } from '@/ui/Unseen'
import { type GridColumns, TileGrid } from '@/ui/TileGrid'
import { ICONS, WrenIcon } from '@/ui/WrenIcon'

const THEME_NAMES = Object.values(WREN_THEMES)

/** How many tiles a row holds: two on a phone, three in a tablet's column. */
const THEME_COLUMNS = {
  [FORM_FACTORS.phone]: 2,
  [FORM_FACTORS.tablet]: 3,
} as const satisfies GridColumns

const useStyles = themedStyles(({ colors }: WrenTheme) => ({
  tile: {
    borderColor: 'transparent',
    borderRadius: RADIUS.md,
    borderWidth: SIZE.focusRing,
    gap: SPACE.s2,
    padding: SPACE.s2,
  },
  picked: { backgroundColor: colors.accentSoft, borderColor: colors.accentText },
  preview: {
    borderRadius: RADIUS.thumb,
    borderWidth: SIZE.hairline,
    flexDirection: 'row',
    height: THEME_SIZES.preview,
    overflow: 'hidden',
  },
  rail: { borderRightWidth: SIZE.hairline, width: '28%' },
  lines: { flex: 1, gap: THEME_SIZES.bar, padding: SPACE.s2 },
  title: { borderRadius: RADIUS.pill, height: THEME_SIZES.bar, width: '70%' },
  meta: { borderRadius: RADIUS.pill, height: THEME_SIZES.bar, width: '45%' },
  pill: {
    borderRadius: RADIUS.pill,
    height: THEME_SIZES.pillHeight,
    marginTop: 'auto',
    width: THEME_SIZES.pillWidth,
  },
  caption: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: SPACE.s2,
    paddingHorizontal: SPACE.s1,
  },
  words: { flex: 1 },
  name: { ...TYPE.tileTitle, color: colors.text },
  scheme: { ...TYPE.small, color: colors.text2 },
  check: {
    alignItems: 'center',
    backgroundColor: colors.accentText,
    borderRadius: RADIUS.pill,
    height: THEME_SIZES.check,
    justifyContent: 'center',
    width: THEME_SIZES.check,
  },
}))

type ThemePreviewProps = { theme: WrenThemeName }

/** A small picture of a theme in its own colours: its ground, a rail, two lines and its accent. */
function ThemePreview({ theme }: ThemePreviewProps) {
  const styles = useStyles()
  const palette = WREN_PALETTES[theme]
  return (
    <View style={[styles.preview, { backgroundColor: palette.bg, borderColor: palette.line2 }]}>
      <View
        style={[styles.rail, { backgroundColor: palette.surface, borderRightColor: palette.line }]}
      />
      <View style={styles.lines}>
        <View style={[styles.title, { backgroundColor: palette.text }]} />
        <View style={[styles.meta, { backgroundColor: palette.text3 }]} />
        <View style={[styles.pill, { backgroundColor: palette.accent }]} />
      </View>
    </View>
  )
}

type ThemeTileProps = {
  theme: WrenThemeName
  width: number
  isPicked: boolean
  onPress: () => void
}

/** A theme's tile: its small picture over its name and scheme, with a check when it is the pick. */
function ThemeTile({ theme, width, isPicked, onPress }: ThemeTileProps) {
  const styles = useStyles()
  const { colors } = useWrenTheme()
  const name = SETTINGS_COPY.themeNames[theme]
  return (
    <Pressable
      accessibilityLabel={name}
      accessibilityRole="radio"
      accessibilityState={{ checked: isPicked }}
      onPress={onPress}
      style={pressedStyleOf({ style: [styles.tile, { width }, isPicked && styles.picked] })}
    >
      <ThemePreview theme={theme} />
      <View style={styles.caption}>
        <View style={styles.words}>
          <Text numberOfLines={1} style={styles.name}>
            {name}
          </Text>
          <Text numberOfLines={1} style={styles.scheme}>
            {SETTINGS_COPY.schemeNames[THEME_SCHEMES[theme]]}
          </Text>
        </View>
        {/* Drawn for every tile, so no tile changes size when it is picked; seen on the picked one alone. */}
        <View style={[styles.check, !isPicked && UNSEEN]}>
          <WrenIcon color={colors.bg} name={ICONS.check} size={SIZE.check} />
        </View>
      </View>
    </Pressable>
  )
}

type ThemePickerProps = {
  /** What the pick sets, said aloud before the themes: "Theme when dark". */
  label: string
  selected: WrenThemeName
  onSelect: (theme: WrenThemeName) => void
}

/** Every theme as a tile in the kit's grid, one of them picked. */
export function ThemePicker({ label, selected, onSelect }: ThemePickerProps) {
  return (
    <View accessibilityLabel={label} accessibilityRole="radiogroup">
      <TileGrid
        columns={THEME_COLUMNS}
        items={THEME_NAMES}
        keyOf={(theme) => theme}
        renderTile={({ item, width }) => (
          <ThemeTile
            isPicked={item === selected}
            onPress={() => onSelect(item)}
            theme={item}
            width={width}
          />
        )}
      />
    </View>
  )
}
