import { classNames } from '@raven/ui/headless'
import styles from '@/ui/Spinner/Spinner.module.scss'

type SpinnerProps = {
  /** Where the place it waits in sets it: a button's own area. */
  className?: string
}

/**
 * A ring that turns while something is on its way, in the text colour around it, and holds
 * still for a listener who asked for less motion. Decorative: what it waits in says so aloud.
 */
export function Spinner({ className }: SpinnerProps) {
  return <span className={classNames([styles.spinner, className])} />
}
