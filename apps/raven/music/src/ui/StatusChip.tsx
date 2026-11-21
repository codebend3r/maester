import { Text, View } from 'react-native'

import { STATUS_COPY } from '@raven/wren'
import { type WrenTheme, themedStyles } from '@/theme/wrenTheme'
import { RADIUS, SIZE, SPACE, TYPE } from '@/theme/wrenTokens'

const useStyles = themedStyles(({ colors }: WrenTheme) => ({
  chip: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderRadius: RADIUS.pill,
    borderWidth: SIZE.hairline,
    flexDirection: 'row',
    gap: SPACE.s2,
    minHeight: SIZE.statusChip,
    paddingHorizontal: SPACE.s3,
  },
  dot: { borderRadius: RADIUS.pill, height: SIZE.statusDot, width: SIZE.statusDot },
  ok: { backgroundColor: colors.ok },
  down: { backgroundColor: colors.accentText },
  label: { ...TYPE.meta, color: colors.text2 },
}))

type StatusChipProps = {
  /** The server's configured name. */
  name: string
  /** Whether the server answers: a green dot, or a red one, and the words for it. */
  isConnected: boolean
}

/**
 * A pill saying how a server is: its dot, its name and its state, the state said in words as
 * well as drawn, so a screen reader and a colour blind eye both hear it.
 */
export function StatusChip({ name, isConnected }: StatusChipProps) {
  const styles = useStyles()
  const label = isConnected ? STATUS_COPY.connected(name) : STATUS_COPY.unreachable(name)
  return (
    <View accessibilityLabel={label} accessible style={styles.chip}>
      <View style={[styles.dot, isConnected ? styles.ok : styles.down]} />
      <Text numberOfLines={1} style={styles.label}>
        {label}
      </Text>
    </View>
  )
}
