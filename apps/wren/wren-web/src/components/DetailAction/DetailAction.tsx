import { type WrenIconName } from '@raven/wren'
import { classNames } from '@raven/ui/headless'
import { WrenIcon } from '@/ui/WrenIcon/WrenIcon'
import styles from '@/components/DetailAction/DetailAction.module.scss'

/** How an action is drawn: its icon over its word, or its icon alone in an outlined circle. */
export const ACTION_SHAPES = { labelled: 'labelled', circle: 'circle' } as const

type ActionShape = (typeof ACTION_SHAPES)[keyof typeof ACTION_SHAPES]

/** The class each named shape wears; with none named, the stylesheet picks by the layout. */
const SHAPE_CLASSES = {
  [ACTION_SHAPES.labelled]: styles.labelled,
  [ACTION_SHAPES.circle]: styles.circle,
} as const satisfies Record<ActionShape, string | undefined>

/** What a switch is to a screen reader: Like and Follow say whether they are on. */
const SWITCH_ROLE = 'switch'

type DetailActionProps = {
  /** The word under the icon on the narrow layout, and what it is called aloud: "Like", "Queue". */
  label: string
  /** Its icon, in the quiet text colour, and in red while a switch is on. */
  icon: WrenIconName
  onPress: () => void
  /** A switch's state, for Like and Follow; left out for a plain button. */
  isOn?: boolean
  /** Its shape whatever the layout: an artist's Follow is always a circle. */
  shape?: ActionShape
}

/**
 * One of an album's, an artist's or a playlist's actions beside Play and Shuffle: Like, Follow,
 * Queue, and on the wide layout More. Under `48rem` it shows its word under the icon, as the
 * apps' phone does; from there it is drawn in a circle, as their tablet does. The stylesheet
 * picks between the two unless `shape` says.
 */
export function DetailAction({ label, icon, onPress, isOn, shape }: DetailActionProps) {
  return (
    <button
      aria-checked={isOn}
      aria-label={label}
      className={classNames([
        styles.action,
        shape === undefined ? styles.byLayout : SHAPE_CLASSES[shape],
        !!isOn && styles.on,
      ])}
      onClick={onPress}
      role={isOn === undefined ? undefined : SWITCH_ROLE}
      type="button"
    >
      <WrenIcon name={icon} />
      <span className={styles.label}>{label}</span>
    </button>
  )
}
