import { SPACE } from '@/theme/tvTokens'
import { themedStyles } from '@/theme/wrenTheme'

/** What every page shares: the theme's ground behind it, and the gap inside each section. */
export const usePageStyles = themedStyles(({ colors }) => ({
  ground: { backgroundColor: colors.bg, flex: 1 },
  section: { gap: SPACE.s3 },
}))
