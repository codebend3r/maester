import { type MediaGroupBy, type MediaItem, type ShownRatings, groupMedia } from '@raven/core'
import { useId } from 'react'
import type { MatchType } from '@/components/FixMatchDialog/FixMatchDialog'
import { Icon } from '@/components/Icon/Icon'
import { MediaGrid } from '@/components/MediaGrid/MediaGrid'
import styles from '@/components/MediaGroups/MediaGroups.module.scss'

const count = new Intl.NumberFormat()

/**
 * The card grid split into a bucket per group, each an accordion row that
 * starts folded: its heading and count show, and a click opens the cards.
 */
export const MediaGroups = ({
  items,
  by,
  busy = false,
  posters = false,
  matchType = null,
  ratingsSource = 'tmdb',
}: {
  items: MediaItem[]
  by: MediaGroupBy
  busy?: boolean
  posters?: boolean
  matchType?: MatchType | null
  ratingsSource?: ShownRatings
}) => {
  const id = useId()
  return (
    <div className={styles.groups} aria-busy={busy}>
      {groupMedia({ items, by }).map((group) => (
        <details key={group.key} className={styles.group}>
          <summary className={styles.summary} aria-labelledby={`${id}-${group.key}`}>
            <h2 id={`${id}-${group.key}`} className={styles.heading}>
              {group.label}
              <span className="visually-hidden">, </span>
              <span className={styles.count}>
                {count.format(group.items.length)} {group.items.length === 1 ? 'video' : 'videos'}
              </span>
            </h2>
            <span className={styles.chevron} aria-hidden="true">
              <Icon name="up" size={18} />
            </span>
          </summary>
          <div className={styles.body}>
            <MediaGrid
              items={group.items}
              posters={posters}
              matchType={matchType}
              ratingsSource={ratingsSource}
            />
          </div>
        </details>
      ))}
    </div>
  )
}
