import { type WrenIconName } from '@raven/wren'
import { classNames } from '@raven/ui/headless'
import { Spinner } from '@/ui/Spinner/Spinner'
import { WrenIcon } from '@/ui/WrenIcon/WrenIcon'
import { SIZES } from '@/theme/tokens'
import styles from '@/ui/Button/Button.module.scss'

/** What a button is for: the page's action, a quieter one, or an outlined one. */
export const BUTTON_VARIANTS = {
  primary: 'primary',
  secondary: 'secondary',
  ghost: 'ghost',
} as const

export type ButtonVariant = (typeof BUTTON_VARIANTS)[keyof typeof BUTTON_VARIANTS]

/** A button's height: 48, or 52 for Sign in. */
export const BUTTON_SIZES = { regular: 'regular', large: 'large' } as const

type ButtonSize = (typeof BUTTON_SIZES)[keyof typeof BUTTON_SIZES]

/** What a button is to its form: its submit, or nothing. */
const BUTTON_TYPES = { submit: 'submit', button: 'button' } as const

type ButtonProps = {
  label: string
  /** What a press does; left out on a form's submit button, whose form hears the submit. */
  onPress?: () => void
  variant?: ButtonVariant
  icon?: WrenIconName
  size?: ButtonSize
  /** Whether it fills the width it is given: Play and Shuffle share their row equally. */
  isStretched?: boolean
  isDisabled?: boolean
  /** Waiting on what it started: a spinner in place of the label, the width kept. */
  isLoading?: boolean
  /** Whether it submits the form it sits in, so Enter in a field presses it. */
  isSubmit?: boolean
}

/** A pill button: Play, Sign in, Cancel, Sign out. */
export function Button({
  label,
  onPress,
  variant = BUTTON_VARIANTS.primary,
  icon,
  size = BUTTON_SIZES.regular,
  isStretched = false,
  isDisabled = false,
  isLoading = false,
  isSubmit = false,
}: ButtonProps) {
  return (
    <button
      aria-busy={isLoading}
      className={classNames([
        styles.button,
        styles[size],
        styles[variant],
        isStretched && styles.stretched,
      ])}
      disabled={isDisabled || isLoading}
      onClick={onPress}
      type={isSubmit ? BUTTON_TYPES.submit : BUTTON_TYPES.button}
    >
      {/* The label keeps its place under the spinner, so the button never changes width. */}
      <span className={classNames([styles.content, isLoading && styles.hidden])}>
        {icon !== undefined && <WrenIcon name={icon} size={SIZES.smallIcon} />}
        <span className={styles.label}>{label}</span>
      </span>
      {isLoading && <Spinner className={styles.spinner} />}
    </button>
  )
}
