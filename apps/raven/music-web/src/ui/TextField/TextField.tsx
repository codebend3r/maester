import { classNames } from '@raven/ui/headless'
import { type ComponentProps, useId } from 'react'
import { SIZES } from '@/theme/tokens'
import { IconButton } from '@/ui/IconButton/IconButton'
import { ICONS, type IconAction, type WrenIconName } from '@/ui/WrenIcon/icons'
import { WrenIcon } from '@/ui/WrenIcon/WrenIcon'
import styles from '@/ui/TextField/TextField.module.scss'

type InputProps = Omit<ComponentProps<'input'>, 'className' | 'id' | 'onChange' | 'aria-label'>

type TextFieldProps = InputProps & {
  label: string
  icon?: WrenIconName
  /** A button at the field's end: Show password. */
  action?: IconAction
  /** What is wrong with what was typed, said under the field. */
  error?: string | null
  onChangeText: (text: string) => void
}

/** A labelled text box: its icon, what is typed, an optional action, and what is wrong with it. */
export function TextField({
  label,
  icon,
  action,
  error = null,
  onChangeText,
  ...input
}: TextFieldProps) {
  const id = useId()
  const errorId = useId()
  const hasError = error !== null
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      <div
        className={classNames([
          styles.box,
          icon !== undefined && styles.led,
          hasError && styles.failed,
        ])}
      >
        {icon !== undefined && <WrenIcon name={icon} size={SIZES.navIcon} />}
        <input
          {...input}
          aria-describedby={hasError ? errorId : undefined}
          aria-invalid={hasError}
          className={styles.input}
          id={id}
          onChange={(event) => onChangeText(event.target.value)}
        />
        {action !== undefined && (
          <IconButton icon={action.icon} label={action.label} onPress={action.onPress} />
        )}
      </div>
      {hasError && (
        <p aria-live="polite" className={styles.error} id={errorId}>
          <WrenIcon name={ICONS.alert} size={SIZES.smallIcon} />
          <span>{error}</span>
        </p>
      )}
    </div>
  )
}
