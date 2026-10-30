import { StyleSheet, Text } from 'react-native'

import { PALETTE, SIZES } from '@/theme/wrenTheme'

type NoticeProps = { text: string }

/** What a page says in place of what it lists: that it is loading, empty, or could not be read. */
export function Notice({ text }: NoticeProps) {
  return (
    <Text accessibilityLiveRegion="polite" style={styles.notice}>
      {text}
    </Text>
  )
}

const styles = StyleSheet.create({
  notice: { color: PALETTE.muted, fontSize: SIZES.text },
})
