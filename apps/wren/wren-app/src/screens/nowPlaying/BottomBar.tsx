import { barWordsOf, type Pane, PANES } from '@raven/wren'
import { Pressable, Text, View } from 'react-native'

import { type WrenTheme, themedStyles, useWrenTheme } from '@/theme/wrenTheme'
import { RADIUS, SIZE, SPACE, TYPE } from '@/theme/wrenTokens'
import { pressedStyleOf } from '@/ui/press'
import { ICONS, WrenIcon, type WrenIconName } from '@/ui/WrenIcon'

const useStyles = themedStyles(({ colors }: WrenTheme) => ({
  bar: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  item: {
    alignItems: 'center',
    borderRadius: RADIUS.pill,
    flexDirection: 'row',
    flexShrink: 1,
    gap: SPACE.s2,
    height: SIZE.touchTarget,
    justifyContent: 'center',
    minWidth: SIZE.touchTarget,
    paddingHorizontal: SPACE.s3,
  },
  active: { backgroundColor: colors.accentSoft },
  label: { ...TYPE.control, color: colors.text2, flexShrink: 1 },
  activeLabel: { color: colors.accentText },
}))

type BarItemProps = {
  icon: WrenIconName
  pane: Pane
  current: Pane
  onPane: (pane: Pane) => void
  /** "raven · This iPhone", the Output pill's words. */
  output: string
}

/** One of the bar's buttons, on a soft red pill while its pane shows. */
function BarItem({ icon, pane, current, onPane, output }: BarItemProps) {
  const styles = useStyles()
  const { colors } = useWrenTheme()
  const isActive = pane === current
  const { label, text } = barWordsOf({ pane, output })
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ selected: isActive }}
      onPress={() => onPane(pane)}
      style={pressedStyleOf({ style: [styles.item, isActive && styles.active] })}
    >
      <WrenIcon color={isActive ? colors.accentText : colors.text2} name={icon} size={SIZE.icon} />
      {text !== null && (
        <Text numberOfLines={1} style={[styles.label, isActive && styles.activeLabel]}>
          {text}
        </Text>
      )}
    </Pressable>
  )
}

// The bar's buttons in the order they sit; the Output pill in the middle shows the player itself.
const BAR_ITEMS = [
  { pane: PANES.lyrics, icon: ICONS.lyrics },
  { pane: PANES.player, icon: ICONS.output },
  { pane: PANES.upNext, icon: ICONS.upNext },
] as const

type BottomBarProps = {
  pane: Pane
  onPane: (pane: Pane) => void
  /** "raven · This iPhone". */
  output: string
}

/**
 * The foot of the phone's Now Playing: Lyrics, the Output pill, which shows the player itself,
 * and Up next. The pane showing gets a soft red pill.
 */
export function BottomBar({ pane, onPane, output }: BottomBarProps) {
  const styles = useStyles()
  return (
    <View style={styles.bar}>
      {BAR_ITEMS.map((item) => (
        <BarItem
          current={pane}
          icon={item.icon}
          key={item.pane}
          onPane={onPane}
          output={output}
          pane={item.pane}
        />
      ))}
    </View>
  )
}
