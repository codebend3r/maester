import { type BingeSeen, type ItemDetails, mediaLabel, watchLink } from '@raven/core'
import { Icon } from '@raven/ui'
import { Link } from 'react-router-dom'
import { BINGE_CARD_COPY } from '@/components/BingeCard/copy'
import { useBingeFacts } from '@/components/BingeCard/useBingeFacts'
import { CardLink } from '@/components/CardLink/CardLink'
import { ItemPoster } from '@/components/PosterImage/PosterImage'
import { Bone, SkeletonPanel } from '@/components/Skeleton/Skeleton'
import { COMMON_COPY } from '@/lib/copy'
import { POSTER_SIZES } from '@/lib/posters'
import styles from '@/pages/BingePage/BingeRow.module.scss'
import { BINGE_ROW_COPY } from '@/pages/BingePage/copy'

type ShowSeenProps = { seen: BingeSeen }

/** How much of the show has been watched: a bar across the row, the episodes and the share beside it. */
const ShowSeen = ({ seen }: ShowSeenProps) => {
  const percent = Math.round((seen.watched / seen.total) * 100)
  return (
    <span className={styles.seen}>
      <progress
        className={styles.bar}
        value={seen.watched}
        max={seen.total}
        aria-label={BINGE_ROW_COPY.seenLabel(seen)}
      />
      <span className={styles.count}>
        {BINGE_ROW_COPY.episodesSeen(seen)}
        {COMMON_COPY.separator}
        {BINGE_ROW_COPY.percentSeen({ percent })}
      </span>
    </span>
  )
}

type BingeRowProps = { details: ItemDetails }

/**
 * A binged title as a row of the Binge page's list: its poster, its title
 * (which opens its page), its year and length, the episode it is on and
 * how far into it, then how much of the show has been watched, and a
 * button that resumes it.
 */
export const BingeRow = ({ details }: BingeRowProps) => {
  const { facts, media, status, page, meta } = useBingeFacts({ details })
  return (
    <li className={styles.row}>
      <Link to={page} className={styles.poster} tabIndex={-1} aria-hidden="true">
        <ItemPoster item={details} sizes={POSTER_SIZES.bingeRow} />
      </Link>
      <span className={styles.copy}>
        <Link to={page} className={styles.title}>
          {details.title}
        </Link>
        {meta.length > 0 && <span className={styles.meta}>{meta.join(COMMON_COPY.separator)}</span>}
        {facts.episodeLine && <span className={styles.episode}>{facts.episodeLine}</span>}
        {status && <span className={styles.status}>{status}</span>}
      </span>
      {facts.seen && <ShowSeen seen={facts.seen} />}
      {media && (
        <CardLink
          {...watchLink({ media })}
          className={styles.play}
          aria-label={BINGE_CARD_COPY.play(mediaLabel(media))}
        >
          <Icon name="play" size={20} />
        </CardLink>
      )}
    </li>
  )
}

/** A row on its way, in the row's own shape: the poster, two lines and the progress. */
export const BingeRowSkeleton = () => (
  <SkeletonPanel className={styles.row}>
    <span className={styles.posterBone}>
      <Bone shape="poster" />
    </span>
    <span className={styles.copy}>
      <Bone shape="text" width="half" />
      <Bone shape="small" width="short" />
    </span>
  </SkeletonPanel>
)
