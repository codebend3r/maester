import {
  type MatchItemType,
  type MediaGroupBy,
  type MediaItem,
  type MediaSort,
  type RatingSource,
  groupMedia,
} from '@raven/core'
import { Bucket } from '@/components/Bucket/Bucket'
import { MediaGrid } from '@/components/MediaGrid/MediaGrid'
import styles from '@/components/MediaGroups/MediaGroups.module.scss'

const count = new Intl.NumberFormat()

type MediaGroupsProps = {
  items: MediaItem[]
  by: MediaGroupBy
  posters?: boolean
  matchType?: MatchItemType | null
  ratingsSource?: RatingSource
  sort?: MediaSort
}

/** The card grid split into a bucket per group, each a folded row that opens on a click. */
export const MediaGroups = ({
  items,
  by,
  posters = false,
  matchType = null,
  ratingsSource = 'tmdb',
  sort,
}: MediaGroupsProps) => (
  <div className={styles.groups}>
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
          sort={sort}
        />
      </Bucket>
    ))}
  </div>
)
