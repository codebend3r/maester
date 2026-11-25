import { classNames } from '@raven/ui/headless'
import { useState } from 'react'
import { COLORS, SIZES } from '@/theme/tokens'
import { BottomSheet } from '@/ui/BottomSheet/BottomSheet'
import { Pressable } from '@/ui/Pressable/Pressable'
import { ICONS, type WrenIconName } from '@/ui/WrenIcon/icons'
import { WrenIcon } from '@/ui/WrenIcon/WrenIcon'
import styles from '@/screens/Collection/ChoiceButton.module.scss'

/** One choice and its word. */
type ChoiceOption<T extends string> = { value: T; label: string }

type ChoiceButtonProps<T extends string> = {
  /** The choice in use, which the button shows and the sheet checks. */
  chosen: T
  /** Every choice with its word, in the order the sheet lists them. */
  options: readonly ChoiceOption<T>[]
  /** The sheet's title and its group's name: "Sort by". */
  title: string
  /** The button's spoken name for the choice in use: "Sort by, Title". */
  spokenLabelOf: (label: string) => string
  icon: WrenIconName
  onChoose: (choice: T) => void
}

/**
 * A list's choice, its order or its cover size, as a red link on the narrow layout and an
 * outlined button on the wide. A press opens a sheet of the choices, the one in use checked.
 */
export function ChoiceButton<T extends string>({
  chosen,
  options,
  title,
  spokenLabelOf,
  icon,
  onChoose,
}: ChoiceButtonProps<T>) {
  const [isOpen, setIsOpen] = useState(false)
  const label = options.find(({ value }) => value === chosen)?.label ?? ''
  const choose = (next: T) => {
    onChoose(next)
    setIsOpen(false)
  }
  return (
    <>
      <Pressable
        className={styles.button}
        label={spokenLabelOf(label)}
        onPress={() => setIsOpen(true)}
      >
        <WrenIcon name={icon} size={SIZES.smallIcon} />
        {label}
      </Pressable>
      <BottomSheet head={{ title }} isOpen={isOpen} onClose={() => setIsOpen(false)}>
        <div aria-label={title} className={styles.options} role="radiogroup">
          {options.map(({ value, label: optionLabel }) => (
            <button
              aria-checked={value === chosen}
              className={classNames([styles.option, value === chosen && styles.chosen])}
              key={value}
              onClick={() => choose(value)}
              // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a pick closes the sheet, which an input's arrow keys would do on the way past each choice
              role="radio"
              type="button"
            >
              <span className={styles.optionLabel}>{optionLabel}</span>
              {value === chosen && (
                <WrenIcon color={COLORS.accentText} name={ICONS.check} size={SIZES.smallIcon} />
              )}
            </button>
          ))}
        </div>
      </BottomSheet>
    </>
  )
}
