import { type Drawing, INKS, type WrenIconName } from '@raven/wren'
import Svg, { Path } from 'react-native-svg'

import { SIZE } from '@/theme/wrenTokens'

type WrenIconProps = {
  name: WrenIconName
  size?: number
  color: string
  /** A line icon's width; the active tab's is drawn at 2. */
  strokeWidth?: number
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

/**
 * One of Wren's icons. It is decorative: the control it sits in carries the label, so a
 * screen reader never stops on the drawing itself.
 */
export function WrenIcon({
  name,
  size = SIZE.icon,
  color,
  strokeWidth = SIZE.stroke,
}: WrenIconProps) {
  const { ink, shapes } = name
  return (
    <Svg
      accessibilityElementsHidden
      height={size}
      importantForAccessibility="no-hide-descendants"
      viewBox="0 0 24 24"
      width={size}
      {...INK_PROPS[ink]({ color, strokeWidth })}
    >
      {shapes.map((shape) => (
        <Path d={shape} key={shape} />
      ))}
    </Svg>
  )
}
