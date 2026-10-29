import { ActivityIndicator, StyleSheet, View } from 'react-native'

import { Logo } from '@/layouts/Logo'
import { themedStyles, useTheme } from '@/theme/useTheme'

type LoadingMarkProps = { label: string; markWidth: number; gap: number }

/**
 * raven's mark with a spinner under it in the theme's text colour, centred on the theme's ground,
 * at the size the platform's kit gives it. The words are for a screen reader alone.
 */
export const LoadingMark = ({ label, markWidth, gap }: LoadingMarkProps) => {
  const styles = useStyles()
  const text = useTheme((theme) => theme.palette.text)
  return (
    <View
      accessibilityLabel={label}
      accessibilityLiveRegion="polite"
      accessibilityRole="progressbar"
      accessible
      style={[styles.ground, { gap }]}
    >
      <Logo width={markWidth} />
      <ActivityIndicator color={text} size="large" />
    </View>
  )
}

const useStyles = themedStyles((colours) =>
  StyleSheet.create({
    ground: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colours.ground,
    },
  }),
)
