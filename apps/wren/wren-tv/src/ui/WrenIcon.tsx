import { type Drawing, INKS, type WrenIconName } from '@raven/wren'
import Svg, { Path } from 'react-native-svg'

import { SIZE } from '@/theme/tvTokens'

type WrenIconProps = {
  name: WrenIconName
  size?: number
  color: string
}

type InkPropsOf = { color: string; strokeWidth: number }

/** How each kind of drawing takes its colour. */
const INK_PROPS = {
  [INKS.stroke]: ({ color, strokeWidth }: InkPropsOf) => ({
    fill: 'none',
    stroke: color,
    strokeWidth,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  }),
  [INKS.fill]: ({ color }: InkPropsOf) => ({ fill: color }),
} as const satisfies Record<Drawing['ink'], (props: InkPropsOf) => object>

// The handoff's line width, in the drawing's own 24 unit box, so it scales with the icon.
const STROKE = 1.75

/**
 * One of Wren's icons. It is decorative: the control it sits in carries the label, so a screen
 * reader never stops on the drawing itself.
 */
export function WrenIcon({ name, size = SIZE.icon, color }: WrenIconProps) {
  const { ink, shapes } = name
  return (
    <Svg
      accessibilityElementsHidden
      height={size}
      importantForAccessibility="no-hide-descendants"
      viewBox="0 0 24 24"
      width={size}
      {...INK_PROPS[ink]({ color, strokeWidth: STROKE })}
    >
      {shapes.map((shape) => (
        <Path d={shape} key={shape} />
      ))}
    </Svg>
  )
}
