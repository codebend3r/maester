import { BRAND, BRAND_INKS, LOCKUP_DRAWING, LOCKUP_VIEW_BOX, WREN_LOCKUP_COPY } from '@raven/wren'
import Svg, { Circle, Path } from 'react-native-svg'

import { SIZE } from '@/theme/tvTokens'
import { useWrenTheme } from '@/theme/wrenTheme'

const { x, y, width, height } = LOCKUP_VIEW_BOX

type WrenLockupProps = {
  /** How tall it is drawn. */
  size?: number
}

/** Wren's mark beside its name, from the brand's lockup, in the ink of the theme's scheme. */
export function WrenLockup({ size = SIZE.logo }: WrenLockupProps) {
  const { scheme } = useWrenTheme()
  const ink = BRAND_INKS[scheme]
  return (
    <Svg
      accessibilityLabel={WREN_LOCKUP_COPY.name}
      accessibilityRole="header"
      accessible
      height={size}
      viewBox={`${x} ${y} ${width} ${height}`}
      width={(size * width) / height}
    >
      <Path d={LOCKUP_DRAWING.body} fill={ink} fillRule="evenodd" />
      {LOCKUP_DRAWING.parts.map((part) => (
        <Path d={part} fill={ink} key={part} />
      ))}
      <Circle {...LOCKUP_DRAWING.eye} fill={BRAND.eyeRed} />
      <Path d={LOCKUP_DRAWING.wordmark} fill={ink} />
    </Svg>
  )
}
