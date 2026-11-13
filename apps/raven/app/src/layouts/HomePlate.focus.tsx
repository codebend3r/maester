import { StyleSheet, View } from 'react-native'

import { HOME_NAV_COPY } from '@/layouts/copy'
import { FocusBand } from '@/layouts/FocusBand'
import { PlateButton } from '@/layouts/tvControls'
import { useGoHome } from '@/layouts/useGoHome'
import { APP_ICONS } from '@/theme/icons'

/**
 * The way back to Home at a TV screen's top left, on every screen but Home, sign-in and the
 * player: a band as wide as its container, so Up from the screen's first row lands on it. It
 * never asks for the focus and never spends the screen's opening focus, so where tvOS gives it
 * the remote first (a loading or notice screen, with nothing else to focus) the page that
 * follows still opens where it asks. A layout keeps it out of any part that spends the opening
 * focus as its controls' focus bubbles up (the grid's header).
 */
export const HomePlate = () => {
  const goHome = useGoHome()
  return (
    <FocusBand>
      <View style={styles.row}>
        <PlateButton icon={APP_ICONS.home} label={HOME_NAV_COPY.home} onPress={goHome} />
      </View>
    </FocusBand>
  )
}

const styles = StyleSheet.create({
  // A column stretches its children, so the plate keeps its own width at the left.
  row: { alignItems: 'flex-start' },
})
