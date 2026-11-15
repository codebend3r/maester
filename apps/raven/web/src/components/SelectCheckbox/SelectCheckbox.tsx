import { classNames } from '@raven/ui'
import type { Selectable } from '@/lib/useSelectable'
import styles from '@/components/SelectCheckbox/SelectCheckbox.module.scss'

type SelectCheckboxProps = {
  select: Selectable
  className?: string
}

/**
 * The checkbox a card shows to be selected, over its picture. It shows only
 * in select mode, on every card, as the card's one tab stop. `className`
 * places it in the card. Outside a scope there is none.
 */
export const SelectCheckbox = ({ select, className }: SelectCheckboxProps) =>
  select.isAvailable && (
    <input
      type="checkbox"
      className={classNames([styles.box, className])}
      {...select.checkboxProps}
    />
  )
