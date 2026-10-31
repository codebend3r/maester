import { Pressable, StyleSheet, Text, View } from 'react-native'

import { OPACITIES, PALETTE, SIZES } from '@/theme/wrenTheme'

type ListRowProps = { title: string; line: string; onPress: () => void }

/** An artist or a playlist in a list: its name, what it holds under it, and a press to open it. */
export function ListRow({ title, line, onPress }: ListRowProps) {
  return (
    <Pressable
      accessibilityLabel={title}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <View style={styles.text}>
        <Text numberOfLines={1} style={styles.title}>
          {title}
        </Text>
        <Text numberOfLines={1} style={styles.line}>
          {line}
        </Text>
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  row: {
    borderBottomColor: PALETTE.line,
    borderBottomWidth: StyleSheet.hairlineWidth,
    minHeight: SIZES.fieldHeight,
    paddingVertical: SIZES.space2,
  },
  text: { gap: SIZES.space1 },
  title: { color: PALETTE.text, fontSize: SIZES.text, fontWeight: 'bold' },
  line: { color: PALETTE.muted, fontSize: SIZES.textSm },
  pressed: { opacity: OPACITIES.pressed },
})
