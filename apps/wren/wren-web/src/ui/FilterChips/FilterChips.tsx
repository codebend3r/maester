import { RadioChoices, type RadioChoicesProps } from '@/ui/RadioChoices/RadioChoices'
import styles from '@/ui/FilterChips/FilterChips.module.scss'

const CLASSES = { group: styles.row, choice: styles.chip, label: styles.label } as const

/** Pills narrowing a list to one kind: All, Songs, Albums, Artists. */
export function FilterChips<K extends string | number>(props: RadioChoicesProps<K>) {
  return <RadioChoices {...props} classes={CLASSES} />
}
