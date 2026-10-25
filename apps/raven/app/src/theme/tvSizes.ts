import { Dimensions, Platform } from 'react-native'

import { SIZES, type Sizes } from '@/theme/appTheme'
import { tvScaleOf } from '@/theme/tvScale'

/**
 * The TV layouts' scale on this device: 1 on Apple TV, a half on a 1080p Android TV, 1 under
 * the thumb, whose layouts never read it. A TV's window keeps its size, so it is read once.
 */
const TV_SCALE = Platform.isTV ? tvScaleOf(Dimensions.get('window')) : 1

/** `points`, a length drawn for a 1920 point TV, on this one. */
export const tvSize = (points: number): number => points * TV_SCALE

/**
 * A TV is read from the sofa, so its type is drawn larger than the shared scale's: the same
 * scale, taken up by this much, and the controls that hold the type grow with it.
 */
const TV_TYPE_BOOST = 1.45

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
  textXs: tvSize(SIZES.textXs * TV_TYPE_BOOST),
  textSm: tvSize(SIZES.textSm * TV_TYPE_BOOST),
  text: tvSize(SIZES.text * TV_TYPE_BOOST),
  textLg: tvSize(SIZES.textLg * TV_TYPE_BOOST),
  textXl: tvSize(SIZES.textXl * TV_TYPE_BOOST),
  measure: tvSize(SIZES.measure),
  fieldHeight: tvSize(SIZES.fieldHeight * TV_TYPE_BOOST),
  controlLarge: tvSize(SIZES.controlLarge * TV_TYPE_BOOST),
  focusRing: tvSize(SIZES.focusRing),
  tvFocusRing: tvSize(SIZES.tvFocusRing),
} as const satisfies Sizes
