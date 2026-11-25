import { Text } from 'react-native'

import { type WrenTheme, themedStyles } from '@/theme/wrenTheme'
import { SPACE, TYPE } from '@/theme/wrenTokens'

const useStyles = themedStyles(({ colors }: WrenTheme) => ({
  notice: { ...TYPE.body, color: colors.text2, paddingVertical: SPACE.s2 },
}))

type NoticeProps = { text: string }

/** What a page says in place of what it lists: that it is loading, empty, or could not be read. */
export function Notice({ text }: NoticeProps) {
  const styles = useStyles()
  return (
    <Text accessibilityLiveRegion="polite" style={styles.notice}>
      {text}
    </Text>
  )
}
