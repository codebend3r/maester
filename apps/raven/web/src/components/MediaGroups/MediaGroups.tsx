import { type MediaGroupBy, type MediaItem, type ShownRatings, groupMedia } from '@raven/core'
import { Bucket } from '@/components/Bucket/Bucket'
import type { MatchType } from '@/components/FixMatchDialog/FixMatchDialog'
import { MediaGrid } from '@/components/MediaGrid/MediaGrid'
import styles from '@/components/MediaGroups/MediaGroups.module.scss'

const count = new Intl.NumberFormat()

/** The card grid split into a bucket per group, each a folded row that opens on a click. */
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
}) => (
  <div className={styles.groups} aria-busy={busy}>
    {groupMedia({ items, by }).map((group) => (
      <Bucket
        key={group.key}
        label={group.label}
        count={`${count.format(group.items.length)} ${group.items.length === 1 ? 'video' : 'videos'}`}
      >
        <MediaGrid
          items={group.items}
          posters={posters}
          matchType={matchType}
          ratingsSource={ratingsSource}
        />
      </Bucket>
    ))}
  </div>
)
