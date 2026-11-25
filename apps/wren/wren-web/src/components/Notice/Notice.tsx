import styles from '@/components/Notice/Notice.module.scss'

type NoticeProps = { text: string }

/** What a page says in place of what it lists: that it is loading, empty, or could not be read. */
export function Notice({ text }: NoticeProps) {
  return (
    <p aria-live="polite" className={styles.notice}>
      {text}
    </p>
  )
}
