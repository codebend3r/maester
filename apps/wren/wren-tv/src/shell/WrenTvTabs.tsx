import { Slot } from 'expo-router'
import { TVFocusGuideView, View } from 'react-native'

import { themedStyles } from '@/theme/wrenTheme'

import { Sidebar } from '@/shell/Sidebar'

const useStyles = themedStyles(({ colors }) => ({
  tabs: { backgroundColor: colors.bg, flex: 1, flexDirection: 'row' },
  page: { flex: 1 },
}))

/**
 * Home, Library, Search and Settings, the phone's four tabs, beside the sidebar that moves
 * between them. A TV has no tab bar: the remote goes left to the sidebar and right to the page.
 */
export function WrenTvTabs() {
  const styles = useStyles()
  return (
    <View style={styles.tabs}>
      <Sidebar />
      <TVFocusGuideView autoFocus style={styles.page}>
        <Slot />
      </TVFocusGuideView>
    </View>
  )
}
