import { type DetailStandInProps, type DetailViews, detailRouteWith } from '@raven/wren-native'
import { Text, View } from 'react-native'

import { SPACE, TYPE } from '@/theme/tvTokens'
import { themedStyles } from '@/theme/wrenTheme'
import { Loading } from '@/ui/Loading'

const useStyles = themedStyles(({ colors }) => ({
  ground: { backgroundColor: colors.bg, flex: 1, gap: SPACE.s4, padding: SPACE.gutter },
  notice: { ...TYPE.body, color: colors.text2 },
}))

/** The page while it is read: the loading mark, its words said aloud. */
function DetailLoading({ text }: DetailStandInProps) {
  const styles = useStyles()
  return (
    <View accessibilityLabel={text} style={styles.ground}>
      <Loading />
    </View>
  )
}

/** The page missing from the server or not read: its words. Back leaves it. */
function DetailNotice({ text }: DetailStandInProps) {
  const styles = useStyles()
  return (
    <View style={styles.ground}>
      <Text accessibilityLiveRegion="polite" style={styles.notice}>
        {text}
      </Text>
    </View>
  )
}

const TV_DETAIL_VIEWS = {
  loading: DetailLoading,
  notice: DetailNotice,
} as const satisfies DetailViews

/**
 * A page reading one thing from its address, the phone's, in the TV's stand-ins. A TV draws no
 * way back: Back on Android TV and Menu on Apple TV leave it.
 */
export const DetailRoute = detailRouteWith({ views: TV_DETAIL_VIEWS })
