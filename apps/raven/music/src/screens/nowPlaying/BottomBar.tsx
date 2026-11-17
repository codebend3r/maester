import { Pressable, Text, View } from 'react-native'

import { PANES, type Pane } from '@/screens/nowPlaying/nowPlayingModel'
import { type WrenTheme, themedStyles, useWrenTheme } from '@/theme/wrenTheme'
import { RADIUS, SIZE, SPACE, TYPE } from '@/theme/wrenTokens'
import { pressedStyleOf } from '@/ui/press'
import { ICONS, WrenIcon, type WrenIconName } from '@/ui/WrenIcon'
import { PLAYER_COPY } from '@/ui/copy'

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
  label: string
  /** The words beside the icon; the Output pill's alone. */
  text?: string
  pane: Pane
  current: Pane
  onPane: (pane: Pane) => void
}

/** One of the bar's buttons, on a soft red pill while its pane shows. */
function BarItem({ icon, label, text, pane, current, onPane }: BarItemProps) {
  const styles = useStyles()
  const { colors } = useWrenTheme()
  const isActive = pane === current
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ selected: isActive }}
      onPress={() => onPane(pane)}
      style={pressedStyleOf({ style: [styles.item, isActive && styles.active] })}
    >
      <WrenIcon color={isActive ? colors.accentText : colors.text2} name={icon} size={SIZE.icon} />
      {text !== undefined && (
        <Text numberOfLines={1} style={[styles.label, isActive && styles.activeLabel]}>
          {text}
        </Text>
      )}
    </Pressable>
  )
}

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
      <BarItem
        current={pane}
        icon={ICONS.lyrics}
        label={PLAYER_COPY.lyrics}
        onPane={onPane}
        pane={PANES.lyrics}
      />
      <BarItem
        current={pane}
        icon={ICONS.output}
        label={output}
        onPane={onPane}
        pane={PANES.player}
        text={output}
      />
      <BarItem
        current={pane}
        icon={ICONS.upNext}
        label={PLAYER_COPY.upNext}
        onPane={onPane}
        pane={PANES.upNext}
      />
    </View>
  )
}
