import {
  type MatchItemType,
  type MediaGroupBy,
  type MediaItem,
  type MediaSort,
  groupMedia,
} from '@raven/core'
import { Bucket } from '@/components/Bucket/Bucket'
import { MediaGrid } from '@/components/MediaGrid/MediaGrid'
import { FactText } from '@raven/ui'
import styles from '@/components/MediaGroups/MediaGroups.module.scss'
import { COMMON_COPY } from '@/lib/copy'
import { CARD_PICTURES, type CardPicture } from '@/lib/cardPictures'

type MediaGroupsProps = {
  items: MediaItem[]
  by: MediaGroupBy
  picture?: CardPicture
  matchType?: MatchItemType | null
  sort?: MediaSort
}

/** The card grid split into a bucket per group, each a folded row that opens on a click. */
export const MediaGroups = ({
  items,
  by,
  picture = CARD_PICTURES.frame,
  matchType = null,
  sort,
}: MediaGroupsProps) => (
  <div className={styles.groups}>
    {groupMedia({ items, by }).map((group) => (
      <Bucket
        key={group.key}
        label={<FactText fact={group.label} />}
        count={COMMON_COPY.videos(group.items.length)}
      >
        <MediaGrid items={group.items} picture={picture} matchType={matchType} sort={sort} />
      </Bucket>
    ))}
  </div>
)
