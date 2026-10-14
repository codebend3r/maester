import { type ItemSummary, type MediaItem, cardTitle } from '@raven/core'
import { useState } from 'react'
import { api } from '@/lib/api'
import { type PosterSizes, posterSources } from '@/lib/posters'
import styles from '@/components/PosterImage/PosterImage.module.scss'

/**
 * A video's poster, else its frame grab cropped to the frame, else its
 * title's first letter. A picture that fails to load falls back the same
 * way. The poster is the video's own item's unless `poster` names another,
 * as an episode shows its season's. The frame is the container's to give,
 * and `sizes` says how wide the container shows it, so the browser fetches
 * a poster no wider than that.
 */
export const PosterImage = ({
  media,
  poster: stand = media.item,
  sizes,
}: {
  media: MediaItem
  poster?: ItemSummary | null
  sizes: PosterSizes
}) => {
  const poster = stand ? posterSources({ item: stand, sizes }) : null
  const thumbnail = api.thumbnailUrl(media)
  const [failed, setFailed] = useState<ReadonlyArray<string>>([])
  const source = [poster?.src, thumbnail].find(
    (url): url is string => url != null && !failed.includes(url),
  )
  if (!source) {
    return (
      <span className={styles.placeholder} aria-hidden="true">
        {cardTitle(media).title.slice(0, 1)}
      </span>
    )
  }
  const isPoster = poster != null && poster.src === source
  return (
    <img
      key={source}
      className={styles.image}
      src={source}
      srcSet={isPoster ? poster.srcSet : undefined}
      sizes={isPoster ? poster.sizes : undefined}
      alt=""
      loading="lazy"
      decoding="async"
      onError={() => setFailed((current) => [...current, source])}
    />
  )
}
