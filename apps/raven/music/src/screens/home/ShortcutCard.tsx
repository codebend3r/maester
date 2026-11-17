import { Pressable, Text, View } from 'react-native'

import { type WrenTheme, themedStyles, useWrenTheme } from '@/theme/wrenTheme'
import { RADIUS, SIZE, SPACE, TYPE } from '@/theme/wrenTokens'
import { Card } from '@/ui/Card'
import { KIT_COPY } from '@/ui/copy'
import { pressedStyleOf } from '@/ui/press'
import { WrenIcon, type WrenIconName } from '@/ui/WrenIcon'

const useStyles = themedStyles(({ colors }: WrenTheme) => ({
  card: { flex: 1 },
  press: { alignItems: 'center', flexDirection: 'row', gap: SPACE.s3, padding: SPACE.s3 },
  tile: {
    alignItems: 'center',
    backgroundColor: colors.surface2,
    borderRadius: RADIUS.item,
    height: SIZE.miniArt,
    justifyContent: 'center',
    width: SIZE.miniArt,
  },
  accent: { backgroundColor: colors.accent },
  text: { flex: 1 },
  title: { ...TYPE.rowStrong, color: colors.text },
  value: { ...TYPE.meta, color: colors.text2 },
}))

type ShortcutCardProps = {
  icon: WrenIconName
  title: string
  /** What it holds: "4,812 songs", "2 albums"; left out while it is not known. */
  value?: string
  onPress: () => void
  /** Whether its icon sits on red: Shuffle all. */
  isAccent?: boolean
  isDisabled?: boolean
}

/** One of Home's shortcuts: an icon on a tile, its name and what it holds. */
export function ShortcutCard({
  icon,
  title,
  value,
  onPress,
  isAccent = false,
  isDisabled = false,
}: ShortcutCardProps) {
  const styles = useStyles()
  const { colors } = useWrenTheme()
  return (
    <Card style={styles.card}>
      <Pressable
        accessibilityLabel={
          value === undefined ? title : KIT_COPY.labelled({ label: title, value })
        }
        accessibilityRole="button"
        accessibilityState={{ disabled: isDisabled }}
        disabled={isDisabled}
        onPress={onPress}
        style={pressedStyleOf({ style: styles.press, isDisabled })}
      >
        <View style={[styles.tile, isAccent && styles.accent]}>
          <WrenIcon
            color={isAccent ? colors.accentInk : colors.text}
            name={icon}
            size={SIZE.icon}
          />
        </View>
        <View style={styles.text}>
          <Text numberOfLines={1} style={styles.title}>
            {title}
          </Text>
          {value !== undefined && (
            <Text numberOfLines={1} style={styles.value}>
              {value}
            </Text>
          )}
        </View>
      </Pressable>
    </Card>
  )
}
