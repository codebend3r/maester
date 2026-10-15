import { useId, useState } from 'react'
import { Button } from '@/components/Button/Button'
import styles from '@/components/Summary/Summary.module.scss'

/** A summary longer than this gets clamped to three lines with More. */
const LONG_SUMMARY = 240

/** An item's tagline and summary, the summary clamped to three lines behind More when it runs long. */
export const Summary = ({
  tagline,
  summary,
  className,
}: {
  tagline: string | null
  summary: string | null
  /** Where the page's layout places it. */
  className?: string
}) => {
  const id = useId()
  const [expanded, setExpanded] = useState(false)
  const text = summary ?? ''
  const long = text.length > LONG_SUMMARY
  if (!tagline && !text) return null
  return (
    <section
      className={className ? `${styles.summary} ${className}` : styles.summary}
      aria-label="Summary"
    >
      {tagline && <p className={styles.tagline}>{tagline}</p>}
      {text && (
        <p id={id} className={long && !expanded ? `${styles.text} ${styles.clamped}` : styles.text}>
          {text}
        </p>
      )}
      {long && (
        <Button
          className={styles.more}
          aria-expanded={expanded}
          aria-controls={id}
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? 'Less' : 'More'}
        </Button>
      )}
    </section>
  )
}
