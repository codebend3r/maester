import {
  DRAWINGS,
  type Drawing,
  ICON_STROKE_WIDTH,
  ICON_VIEW_BOX,
  type IconName,
} from '@/components/Icon/drawings'
import styles from '@/components/Icon/Icon.module.scss'

/** Arrows nudge their own way under the pointer instead of popping. */
const NUDGES: Partial<Record<IconName, string>> = {
  back: styles.nudgeBack,
  rewind: styles.nudgeBack,
  next: styles.nudgeOn,
  forward: styles.nudgeOn,
  convert: styles.nudgeOn,
  signOut: styles.nudgeOn,
  up: styles.nudgeUp,
  download: styles.nudgeDown,
}

const isIconName = (name: string): name is IconName => name in DRAWINGS

/** Every icon there is, for the design page. */
export const ICON_NAMES: readonly IconName[] = Object.keys(DRAWINGS).filter(isIconName)

/** How wide an icon is: pixels, or ems of the text it sits in, to grow and shrink with it. */
export type IconSize = number | `${number}em`

type IconProps = { name: IconName; size?: IconSize }

/**
 * Line icons with a soft tint under their main shape, which doubles while
 * the control around them is pointed at; a control marks itself current by
 * setting `--icon-tint`. Decorative by default: pair them with text or an
 * aria-label on the control.
 */
export const Icon = ({ name, size = 20 }: IconProps) => {
  // Each entry is its own literal shape; read through `Drawing` so the optional paths are plain.
  const drawing: Drawing = DRAWINGS[name]
  const { stroke, fill, marks } = drawing
  return (
    <svg
      width={size}
      height={size}
      viewBox={ICON_VIEW_BOX}
      fill="none"
      stroke="currentColor"
      strokeWidth={ICON_STROKE_WIDTH}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      data-icon={name}
      className={`${styles.icon} ${NUDGES[name] ?? styles.pop}`}
    >
      {!!fill && <path className={styles.fill} d={fill} fill="currentColor" stroke="none" />}
      {!!stroke && <path d={stroke} />}
      {!!marks && <path className={styles.marks} d={marks} fill="currentColor" stroke="none" />}
    </svg>
  )
}
