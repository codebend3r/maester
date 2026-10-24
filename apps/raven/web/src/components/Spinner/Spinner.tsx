import styles from '@/components/Spinner/Spinner.module.scss'

/** A ring that turns while something runs, as long as the viewer allows motion; decorative, so what it sits beside says what is happening. */
export const Spinner = () => <span className={styles.spinner} aria-hidden="true" />
