import { RadioChoices, type RadioChoicesProps } from '@/ui/RadioChoices/RadioChoices'
import styles from '@/ui/FilterChips/FilterChips.module.scss'

const CLASSES = { group: styles.row, choice: styles.chip, label: styles.label } as const

type FilterChipsProps<K extends string | number> = Omit<RadioChoicesProps<K>, 'choices'> & {
  chips: RadioChoicesProps<K>['choices']
}

/** Pills narrowing a list to one kind: All, Songs, Albums, Artists. */
export function FilterChips<K extends string | number>({ chips, ...props }: FilterChipsProps<K>) {
  return <RadioChoices {...props} choices={chips} classes={CLASSES} />
}
