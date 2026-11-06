import { useQuery } from '@tanstack/react-query'
import {
  ITEM_IMAGE_KINDS,
  ITEM_TYPES,
  type ItemDetails,
  bingeCardFacts,
  itemPath,
  mediaLabel,
  watchLink,
} from '@raven/core'
import { Icon } from '@raven/ui'
import { Link } from 'react-router-dom'
import { BINGE_CARD_COPY } from '@/components/BingeCard/copy'
import { bingeStatusWords } from '@/components/BingeCard/bingeStatus'
import { CardLink } from '@/components/CardLink/CardLink'
import { ResumeBar } from '@/components/ResumeBar/ResumeBar'
import { Bone, SkeletonPanel } from '@/components/Skeleton/Skeleton'
import { api } from '@/lib/api'
import { COMMON_COPY } from '@/lib/copy'
import { itemQuery, nextEpisodeQuery } from '@/lib/queries'
import styles from '@/components/BingeCard/BingeCard.module.scss'

/**
 * The card's backdrop: the first card spans the Binge grid's two columns,
 * the rest take one, and the card does not know which it is, so past the
 * width Chrome lays it out at it allows for the whole screen.
 */
export const BINGE_BACKDROP_SIZES = 'auto, 100vw'

type BingeCardProps = { details: ItemDetails }

/**
 * A binged movie or show as a jumbo card on its backdrop: its logo in the top
 * left corner, standing for its name, or its title in the display face where
 * it has no logo, then its year and length, the episode it is on, its two
 * leading stars and a snippet of the synopsis (the episode's, for a show).
 * Across the foot, how far along it is, with how long is left at the bottom
 * right, or the episode to start on where it is not started yet. The card
 * resumes it; the logo or title opens its page.
 */
export const BingeCard = ({ details }: BingeCardProps) => {
  const isShow = details.type === ITEM_TYPES.show
  const next = useQuery({ ...nextEpisodeQuery(details.id), enabled: isShow })
  const episodeId = isShow ? (next.data?.item?.id ?? null) : null
  const episode = useQuery(itemQuery(episodeId))
  const facts = bingeCardFacts({
    details,
    next: next.data ?? null,
    episode: episode.data ?? null,
  })
  const media = next.data ?? null
  const status = bingeStatusWords(facts.status)
  const backdrop =
    details.backdropVersion == null
      ? media && api.thumbnailUrl(media)
      : api.itemImageUrl({
          id: details.id,
          kind: ITEM_IMAGE_KINDS.backdrop,
          version: details.backdropVersion,
        })
  const backdropSrcSet = api.backdropSrcSet({ id: details.id, version: details.backdropVersion })
  const logo =
    details.logoVersion == null
      ? null
      : api.itemImageUrl({
          id: details.id,
          kind: ITEM_IMAGE_KINDS.logo,
          version: details.logoVersion,
        })
  const page = itemPath(details) ?? '/'
  const meta = [facts.year, facts.runtime].filter((fact): fact is string => fact != null)

  return (
    <li className={`${styles.frame} ${styles.card}`}>
      {media && (
        <CardLink
          {...watchLink({ media })}
          className={styles.play}
          aria-label={BINGE_CARD_COPY.play(mediaLabel(media))}
        >
          <span className={styles.mark}>
            <Icon name="play" size={24} />
          </span>
        </CardLink>
      )}
      {logo && (
        <Link to={page} className={styles.logoSlot} aria-label={details.title}>
          <img className={styles.logo} src={logo} alt="" decoding="async" />
        </Link>
      )}
      <span className={styles.copy}>
        {!logo && (
          <Link to={page} className={styles.title}>
            {details.title}
          </Link>
        )}
        {meta.length > 0 && <span className={styles.meta}>{meta.join(COMMON_COPY.separator)}</span>}
        {facts.episodeLine && <span className={styles.episode}>{facts.episodeLine}</span>}
        {facts.stars.length > 0 && (
          <span className={styles.stars}>
            {BINGE_CARD_COPY.starring}{' '}
            {facts.stars.map((star, index) => (
              <span key={star}>
                {index > 0 && COMMON_COPY.listSeparator}
                <span className={styles.star}>{star}</span>
              </span>
            ))}
          </span>
        )}
        {facts.synopsis && <span className={styles.synopsis}>{facts.synopsis}</span>}
      </span>
      {media && status && (
        <span className={styles.progress}>
          <ResumeBar media={media} className={styles.bar} />
          <span className={styles.status}>{status}</span>
        </span>
      )}
      <span className={styles.backdrop}>
        {backdrop && (
          <img
            className={styles.picture}
            src={backdrop}
            srcSet={backdropSrcSet ?? undefined}
            sizes={BINGE_BACKDROP_SIZES}
            alt=""
            loading="lazy"
            decoding="async"
          />
        )}
      </span>
    </li>
  )
}

/**
 * A binged title on its way, in the card's own shape: a line for its logo in
 * the corner, its words above the foot and its progress across it.
 */
export const BingeCardSkeleton = () => (
  <SkeletonPanel className={styles.frame}>
    <span className={styles.skeletonLogo}>
      <Bone shape="heading" />
    </span>
    <span className={styles.skeletonCopy}>
      <Bone shape="small" width="short" />
      <Bone shape="text" width="most" />
      <Bone shape="text" width="half" />
    </span>
    <span className={styles.skeletonProgress}>
      <Bone shape="small" />
    </span>
  </SkeletonPanel>
)
