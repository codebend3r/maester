import { tvScaleOf } from '@raven/native/headless'
import { Dimensions } from 'react-native'

import { FONTS } from '@/theme/tvFonts'

/*
 * Wren on TV's sizes, drawn for a 1920 point screen read from across the room and scaled to the
 * TV showing them. The palettes are `@raven/wren`'s, every Wren's; the faces are the phone app's.
 */

// A TV's window keeps its size, so it is read once.
const SCALE = tvScaleOf(Dimensions.get('window'))

/** `points`, a length drawn for a 1920 point TV, on this one. */
const tvSize = (points: number): number => points * SCALE

/** The gaps, on the phone's steps, made for the sofa. */
export const SPACE = {
  s1: tvSize(8),
  s2: tvSize(16),
  s3: tvSize(24),
  s4: tvSize(32),
  s6: tvSize(48),
  s8: tvSize(64),
  /** The title-safe margin every screen keeps from the TV's edges. */
  gutter: tvSize(80),
} as const

export const RADIUS = {
  thumb: tvSize(12),
  item: tvSize(18),
  card: tvSize(24),
  pill: 999,
} as const

/** The type scale: Young Serif for identity, Instrument Sans for everything else. */
export const TYPE = {
  hero: { fontFamily: FONTS.display, fontSize: tvSize(76), lineHeight: tvSize(88) },
  title: { fontFamily: FONTS.display, fontSize: tvSize(56), lineHeight: tvSize(66) },
  section: { fontFamily: FONTS.bodySemiBold, fontSize: tvSize(34), lineHeight: tvSize(44) },
  cardTitle: { fontFamily: FONTS.display, fontSize: tvSize(36), lineHeight: tvSize(46) },
  tileTitle: { fontFamily: FONTS.display, fontSize: tvSize(28), lineHeight: tvSize(36) },
  tileLine: { fontFamily: FONTS.bodySemiBold, fontSize: tvSize(24), lineHeight: tvSize(32) },
  row: { fontFamily: FONTS.bodyMedium, fontSize: tvSize(30), lineHeight: tvSize(38) },
  button: { fontFamily: FONTS.bodySemiBold, fontSize: tvSize(28), lineHeight: tvSize(36) },
  body: { fontFamily: FONTS.body, fontSize: tvSize(28), lineHeight: tvSize(38) },
  meta: { fontFamily: FONTS.body, fontSize: tvSize(24), lineHeight: tvSize(32) },
  lyric: { fontFamily: FONTS.display, fontSize: tvSize(44), lineHeight: tvSize(58) },
  time: {
    fontFamily: FONTS.body,
    fontSize: tvSize(24),
    lineHeight: tvSize(32),
    fontVariant: ['tabular-nums'],
  },
  overline: {
    fontFamily: FONTS.bodySemiBold,
    fontSize: tvSize(22),
    lineHeight: tvSize(28),
    letterSpacing: tvSize(1.3),
    textTransform: 'uppercase',
  },
} as const

/** The fixed sizes of the kit and its screens. */
export const SIZE = {
  /** The ring a focused control wears, and how far a focused tile stands out. */
  focusRing: tvSize(5),
  focusScale: 1.06,
  button: tvSize(80),
  icon: tvSize(40),
  iconSmall: tvSize(30),
  row: tvSize(96),
  rowArt: tvSize(72),
  tile: tvSize(260),
  tileSmall: tvSize(200),
  tileLarge: tvSize(340),
  /** Albums' covers at each of the Cover size choices, the phone's five steps made for the sofa. */
  coverExtraSmall: tvSize(160),
  coverSmall: tvSize(210),
  coverExtraLarge: tvSize(440),
  artistPhoto: tvSize(220),
  headArt: tvSize(440),
  playerArt: tvSize(560),
  sidebarOpen: tvSize(360),
  sidebarClosed: tvSize(128),
  logo: tvSize(56),
  field: tvSize(84),
  fieldWidth: tvSize(760),
  sheetWidth: tvSize(760),
  scrubber: tvSize(10),
  scrubberThumb: tvSize(28),
  equalizer: tvSize(28),
} as const

export const OPACITIES = { disabled: 0.4, sung: 0.5 } as const
