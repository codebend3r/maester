import { StyleSheet, View } from 'react-native'

import { HomePlate } from '@/layouts/HomePlate.focus'
import type { LoadingKit, LoadingProps } from '@/layouts/loadingKit'
import { LoadingMark } from '@/layouts/LoadingMark'
import { TV_GUTTER, TV_SIZES } from '@/theme/tvSizes'

/**
 * A TV's loading screen, read from across the room; Back is the remote's own key, and the way
 * Home sits over the mark's top left on every screen but Home, leaving the mark centred.
 */
const Loading = ({ label, isHome = false }: LoadingProps) => (
  <View style={styles.screen}>
    <LoadingMark gap={TV_SIZES.space5} label={label} markWidth={TV_SIZES.space8 * 2} />
    {!isHome && (
      <View style={styles.nav}>
        <HomePlate />
      </View>
    )}
  </View>
)

const styles = StyleSheet.create({
  screen: { flex: 1 },
  nav: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingTop: TV_SIZES.space6,
    paddingHorizontal: TV_GUTTER,
  },
})

export const focusLoading: LoadingKit = { Loading }
