import { type Drawing, INKS, type WrenIconName } from '@raven/wren'
import { type Color, type Size, type TokenStyle } from '@/theme/tokens'
import styles from '@/ui/WrenIcon/WrenIcon.module.scss'

/** A line icon's width: 1.75, and 2 for the tab showing. */
export const STROKES = { regular: 1.75, active: 2 } as const

type Stroke = (typeof STROKES)[keyof typeof STROKES]

type WrenIconProps = {
  name: WrenIconName
  /** How wide and tall it is drawn; the control it sits in decides unless this does. */
  size?: Size
  /** Its colour; the text colour of where it sits unless this names another. */
  color?: Color
  /** A line icon's width; the active tab's is drawn at 2. */
  strokeWidth?: Stroke
}

type InkPropsOf = { strokeWidth: Stroke }

/** How each kind of drawing takes its colour, which is always the text colour around it. */
const INK_PROPS = {
  [INKS.stroke]: ({ strokeWidth }: InkPropsOf) =>
    ({
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
    }) as const,
  [INKS.fill]: () => ({ fill: 'currentColor' }) as const,
} as const satisfies Record<Drawing['ink'], (props: InkPropsOf) => object>

/**
 * One of Wren's icons. It is decorative: the control it sits in carries the label, so a
 * screen reader never stops on the drawing itself.
 */
export function WrenIcon({ name, size, color, strokeWidth = STROKES.regular }: WrenIconProps) {
  const { ink, shapes } = name
  const style: TokenStyle = { '--icon-size': size, color }
  return (
    <svg
      aria-hidden="true"
      className={styles.icon}
      focusable="false"
      style={style}
      viewBox="0 0 24 24"
      {...INK_PROPS[ink]({ strokeWidth })}
    >
      {shapes.map((shape) => (
        <path d={shape} key={shape} />
      ))}
    </svg>
  )
}
