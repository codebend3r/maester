import {
  type MatchItemType,
  type MediaGroupBy,
  type MediaItem,
  type MediaSort,
  RATING_SOURCES,
  type RatingSource,
  groupMedia,
} from '@raven/core'
import { Bucket } from '@/components/Bucket/Bucket'
import { MediaGrid } from '@/components/MediaGrid/MediaGrid'
import { FactText } from '@/components/ResolutionChip/ResolutionChip'
import styles from '@/components/MediaGroups/MediaGroups.module.scss'
import { COMMON_COPY } from '@/lib/copy'

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
  ratingsSource = RATING_SOURCES.tmdb,
  sort,
}: MediaGroupsProps) => (
  <div className={styles.groups}>
    {groupMedia({ items, by }).map((group) => (
      <Bucket
        key={group.key}
        label={<FactText fact={group.label} />}
        count={COMMON_COPY.videos(group.items.length)}
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
