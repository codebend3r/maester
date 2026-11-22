import { RadioChoices, type RadioChoicesProps } from '@/ui/RadioChoices/RadioChoices'
import styles from '@/ui/SegmentedControl/SegmentedControl.module.scss'

const CLASSES = { group: styles.track, choice: styles.segment, label: styles.label } as const

/**
 * A row of equal-width choices on a track, one of them picked: Appearance's Match device and
 * One theme. It never scrolls sideways, so its labels are kept short enough to fit. The arrow keys
 * move the pick, as they do any set of radio buttons.
 */
export function SegmentedControl<K extends string | number>(props: RadioChoicesProps<K>) {
  return <RadioChoices {...props} classes={CLASSES} />
}
