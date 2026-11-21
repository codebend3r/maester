import { classNames } from '@raven/ui/headless'
import { useId } from 'react'
import styles from '@/ui/RadioChoices/RadioChoices.module.scss'

/** One choice of a control or a chip row: what it stands for and what it says. */
export type Choice<K extends string | number> = { key: K; label: string }

/** The classes the place that draws the choices gives each part. */
type ChoiceClasses = {
  group: string | undefined
  choice: string | undefined
  label: string | undefined
}

export type RadioChoicesProps<K extends string | number> = {
  /** What the choices set, said aloud before them. */
  label: string
  choices: readonly Choice<K>[]
  selected: K
  onSelect: (key: K) => void
}

type RadioChoicesOfProps<K extends string | number> = RadioChoicesProps<K> & {
  classes: ChoiceClasses
}

/**
 * A set of choices with one picked, as radio buttons a place draws its own way: each radio
 * covers its choice, unseen, so the whole choice is its press, and the arrow keys move the pick
 * as they do any set of radio buttons. The place styles the picked one with `input:checked + &`.
 */
export function RadioChoices<K extends string | number>({
  label,
  choices,
  selected,
  onSelect,
  classes,
}: RadioChoicesOfProps<K>) {
  const name = useId()
  return (
    <fieldset aria-label={label} className={classes.group} role="radiogroup">
      {choices.map((choice) => (
        <label className={classNames([styles.choice, classes.choice])} key={choice.key}>
          <input
            checked={choice.key === selected}
            className={styles.input}
            name={name}
            onChange={() => onSelect(choice.key)}
            type="radio"
          />
          <span className={classNames([styles.label, classes.label])}>{choice.label}</span>
        </label>
      ))}
    </fieldset>
  )
}
