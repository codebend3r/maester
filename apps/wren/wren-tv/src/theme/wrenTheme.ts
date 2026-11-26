import { createWrenTheming } from '@raven/wren-native'

import { useWrenPrefs } from '@/stores/wrenPrefs'

export type { WrenTheme } from '@raven/wren-native'

/**
 * The TV's scheme, the theme showing and `themedStyles`, every Wren's on React Native, over
 * the theme choice the TV's own prefs keep.
 */
export const { useSystemScheme, useWrenTheme, themedStyles } = createWrenTheming({
  useThemeChoice: useWrenPrefs,
})
