import { type MediaGroupBy, type MediaItem, groupMedia } from '@raven/core'
import { useId } from 'react'
import { MediaGrid } from '@/components/MediaGrid/MediaGrid'
import styles from '@/components/MediaGroups/MediaGroups.module.scss'

const count = new Intl.NumberFormat()

/** The card grid split into a section per bucket, each under its own heading. */
export const MediaGroups = ({
  items,
  by,
  busy = false,
}: {
  items: MediaItem[]
  by: MediaGroupBy
  busy?: boolean
}) => {
  const id = useId()
  return (
    <div className={styles.groups} aria-busy={busy}>
      {groupMedia({ items, by }).map((group) => (
        <section key={group.key} className={styles.group} aria-labelledby={`${id}-${group.key}`}>
          <h2 id={`${id}-${group.key}`} className={styles.heading}>
            {group.label}
            <span className="visually-hidden">, </span>
            <span className={styles.count}>
              {count.format(group.items.length)} {group.items.length === 1 ? 'video' : 'videos'}
            </span>
          </h2>
          <MediaGrid items={group.items} />
        </section>
      ))}
    </div>
  )
}
