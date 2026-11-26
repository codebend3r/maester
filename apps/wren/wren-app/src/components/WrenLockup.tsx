import Svg, { Circle, Path } from 'react-native-svg'

import {
  BRAND,
  BRAND_INKS,
  LOCKUP_DRAWING,
  LOCKUP_VIEW_BOX,
  MARK_VIEW_BOX,
  WREN_LOCKUP_COPY,
} from '@raven/wren'
import { useWrenTheme } from '@/theme/wrenTheme'

// 64 points tall, where the brand's rules give the mark its full cut.
const LOCKUP_HEIGHT = 64

const { x, y, width, height } = LOCKUP_VIEW_BOX

type WrenLockupProps = {
  /** How tall it is drawn: 64 on sign-in, 34 atop the tablet's sidebar. */
  size?: number
  /** The bird's and the name's colour; the scheme's (`BRAND_INKS`) unless a ground fixes it. */
  ink?: string
}

/** The ink a logo is drawn in: the one asked for, else the one for the scheme of the theme showing. */
const useInk = (ink: string | undefined): string => {
  const { scheme } = useWrenTheme()
  return ink ?? BRAND_INKS[scheme]
}

type BirdProps = { ink: string }

/** The bird's shapes, in the lockup's and the mark's shared coordinates. */
function Bird({ ink }: BirdProps) {
  return (
    <>
      <Path d={LOCKUP_DRAWING.body} fill={ink} fillRule="evenodd" />
      {LOCKUP_DRAWING.parts.map((part) => (
        <Path d={part} fill={ink} key={part} />
      ))}
      <Circle {...LOCKUP_DRAWING.eye} fill={BRAND.eyeRed} />
    </>
  )
}

/** Wren's mark beside its name, from the brand's lockup, read out as a header. */
export function WrenLockup({ size = LOCKUP_HEIGHT, ink }: WrenLockupProps) {
  const color = useInk(ink)
  return (
    <Svg
      accessibilityLabel={WREN_LOCKUP_COPY.name}
      accessibilityRole="header"
      accessible
      height={size}
      viewBox={`${x} ${y} ${width} ${height}`}
      width={(size * width) / height}
    >
      <Bird ink={color} />
      <Path d={LOCKUP_DRAWING.wordmark} fill={color} />
    </Svg>
  )
}

type WrenMarkProps = {
  /** How wide it is drawn; the full cut is for 64 and up. */
  size: number
  /** The bird's colour; the scheme's unless a ground fixes it. */
  ink?: string
}

/**
 * Wren's mark alone, the bird without its name. It is decorative: the screen it heads names
 * Wren in words, so a screen reader passes over it.
 */
export function WrenMark({ size, ink }: WrenMarkProps) {
  const color = useInk(ink)
  return (
    <Svg
      accessibilityElementsHidden
      height={(size * MARK_VIEW_BOX.height) / MARK_VIEW_BOX.width}
      importantForAccessibility="no-hide-descendants"
      viewBox={`${MARK_VIEW_BOX.x} ${MARK_VIEW_BOX.y} ${MARK_VIEW_BOX.width} ${MARK_VIEW_BOX.height}`}
      width={size}
    >
      <Bird ink={color} />
    </Svg>
  )
}
