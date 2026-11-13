import { type ReactNode, useId } from 'react'
import styles from '@/pages/SettingsPage/SettingsPage.module.scss'

type ToggleChoiceProps = {
  label: string
  /** What turning it on does, under its name; read with the box by a screen reader. */
  hint?: ReactNode
  isChecked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
}

/** A setting that is on or off: its box, its name and, under them, what it does. */
export const ToggleChoice = ({
  label,
  hint,
  isChecked,
  disabled = false,
  onChange,
}: ToggleChoiceProps) => {
  const hintId = useId()
  const hasHint = hint !== undefined
  return (
    <label className={styles.choice}>
      <input
        type="checkbox"
        checked={isChecked}
        disabled={disabled}
        aria-describedby={hasHint ? hintId : undefined}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className={styles.choiceLabel}>{label}</span>
      {hasHint && (
        <span id={hintId} className={styles.choiceHint}>
          {hint}
        </span>
      )}
    </label>
  )
}
