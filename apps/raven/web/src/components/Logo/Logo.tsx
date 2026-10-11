import styles from '@/components/Logo/Logo.module.scss'

/**
 * The mark beside the wordmark, drawn for the night ground. The mark is
 * decoration: the word names whatever wraps it.
 */
export const Logo = () => (
  <span className={styles.logo}>
    <img
      src="/brand/raven-mark-on-dark.svg"
      alt=""
      width={646}
      height={705}
      className={styles.mark}
    />
    <span className={styles.word}>raven</span>
  </span>
)
