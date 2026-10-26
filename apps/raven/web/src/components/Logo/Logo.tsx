import { themeOf } from '@raven/core'
import { useTheme } from '@/stores/theme'
import styles from '@/components/Logo/Logo.module.scss'

/** Each mark is drawn for its ground: bark on a dark one, the original ink and red on a light one. */
const MARKS = {
  dark: '/brand/raven-mark-on-dark.svg',
  light: '/brand/raven-mark-on-light.svg',
} as const

type LogoProps = { isMarkOnly?: boolean }

/**
 * The mark beside the wordmark, drawn for the theme's ground. The mark is
 * decoration: the word names whatever wraps it. `isMarkOnly` leaves the
 * word out, for a side menu down to its icons.
 */
export const Logo = ({ isMarkOnly = false }: LogoProps) => {
  const tone = useTheme((state) => themeOf(state.theme).tone)
  return (
    <span className={isMarkOnly ? `${styles.logo} ${styles.markOnly}` : styles.logo}>
      <img src={MARKS[tone]} alt="" width={646} height={705} className={styles.mark} />
      <span className={isMarkOnly ? 'visually-hidden' : styles.word}>raven</span>
    </span>
  )
}
