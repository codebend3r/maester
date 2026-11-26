import { KIT_COPY } from '@raven/wren'
import { ActivityIndicator, View } from 'react-native'

import { SPACE } from '@/theme/tvTokens'
import { themedStyles, useWrenTheme } from '@/theme/wrenTheme'

const useStyles = themedStyles(() => ({
  loading: { alignItems: 'center', paddingVertical: SPACE.s8 },
}))

/** What stands where a list or a page will be while it is read, said aloud as Loading. */
export function Loading() {
  const styles = useStyles()
  const { colors } = useWrenTheme()
  return (
    <View accessibilityLabel={KIT_COPY.loading} accessible style={styles.loading}>
      <ActivityIndicator color={colors.text2} size="large" />
    </View>
  )
}
