import { usePageBackdrop } from '@/stores/pageBackdrop'
import styles from '@/components/PageBackdrop/PageBackdrop.module.scss'

/**
 * Behind the whole page: the picture of the card pointed at or focused, so
 * moving across a grid changes the background from one card to the next.
 * A picture still loading leaves the one before it up, then the two cross
 * fade; pointing at nothing fades it away. The store decides which shows.
 */
export const PageBackdrop = () => {
  const shown = usePageBackdrop((state) => state.shown)
  const recent = usePageBackdrop((state) => state.recent)
  const markLoaded = usePageBackdrop((state) => state.markLoaded)
  return (
    <div className={styles.backdrop} aria-hidden="true">
      {recent.map((url) => (
        <img
          key={url}
          className={url === shown ? `${styles.layer} ${styles.shown}` : styles.layer}
          src={url}
          alt=""
          decoding="async"
          onLoad={() => markLoaded(url)}
        />
      ))}
    </div>
  )
}
