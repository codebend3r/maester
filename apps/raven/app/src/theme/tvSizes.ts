import { Dimensions, Platform } from 'react-native'

import { SIZES } from '@/theme/appTheme'
import { tvScaleOf } from '@/theme/tvScale'

/**
 * The TV layouts' scale on this device: 1 on Apple TV, a half on a 1080p Android TV, 1 under
 * the thumb, whose layouts never read it. A TV's window keeps its size, so it is read once.
 */
const TV_SCALE = Platform.isTV ? tvScaleOf(Dimensions.get('window')) : 1

/** `points`, a length drawn for a 1920 point TV, on this one. */
export const tvSize = (points: number): number => points * TV_SCALE

/** The shared scale's lengths as the TV layouts draw them, sized to the screen. */
export const TV_SIZES = {
  space0: tvSize(SIZES.space0),
  space1: tvSize(SIZES.space1),
  space2: tvSize(SIZES.space2),
  space3: tvSize(SIZES.space3),
  space4: tvSize(SIZES.space4),
  space5: tvSize(SIZES.space5),
  space6: tvSize(SIZES.space6),
  space8: tvSize(SIZES.space8),
  radius: tvSize(SIZES.radius),
  textXs: tvSize(SIZES.textXs),
  textSm: tvSize(SIZES.textSm),
  text: tvSize(SIZES.text),
  textLg: tvSize(SIZES.textLg),
  textXl: tvSize(SIZES.textXl),
  measure: tvSize(SIZES.measure),
  fieldHeight: tvSize(SIZES.fieldHeight),
  controlLarge: tvSize(SIZES.controlLarge),
  focusRing: tvSize(SIZES.focusRing),
  tvFocusRing: tvSize(SIZES.tvFocusRing),
} as const satisfies Record<keyof typeof SIZES, number>
