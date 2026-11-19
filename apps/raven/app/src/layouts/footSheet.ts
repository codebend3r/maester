import type { ViewStyle } from 'react-native'

import { type Palette, SIZES } from '@/theme/appTheme'

/** A foot sheet's tallest, as a share of the room it rises in. */
const SHEET_MAX_SHARE = '85%'

/**
 * The panel every sheet up from the screen's foot wears (the More sheet, the sheets raven draws
 * on Android): the theme's ground with rounded top corners under a hairline, never taller than
 * its share of the room. Each sheet adds its own place and padding.
 */
export const footSheetPanelOf = (colours: Palette) =>
  ({
    maxHeight: SHEET_MAX_SHARE,
    gap: SIZES.space2,
    backgroundColor: colours.ground,
    borderTopLeftRadius: SIZES.radiusLg,
    borderTopRightRadius: SIZES.radiusLg,
    borderTopWidth: 1,
    borderTopColor: colours.line,
  }) as const satisfies ViewStyle
