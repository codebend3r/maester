import { type ItemSummary, type MediaItem, cardTitle } from '@raven/core'
import { useState } from 'react'
import { api } from '@/lib/api'
import styles from '@/components/PosterImage/PosterImage.module.scss'

/**
 * A video's poster, else its frame grab cropped to the frame, else its
 * title's first letter. A picture that fails to load falls back the same
 * way. The poster is the video's own item's unless `poster` names another,
 * as an episode shows its season's. The frame is the container's to give.
 */
export const PosterImage = ({
  media,
  poster: stand = media.item,
}: {
  media: MediaItem
  poster?: ItemSummary | null
}) => {
  const poster = stand
    ? api.itemImageUrl({ id: stand.id, kind: 'poster', version: stand.posterVersion })
    : null
  const thumbnail = api.thumbnailUrl(media)
  const [failed, setFailed] = useState<ReadonlyArray<string>>([])
  const source = [poster, thumbnail].find(
    (url): url is string => url != null && !failed.includes(url),
  )
  if (!source) {
    return (
      <span className={styles.placeholder} aria-hidden="true">
        {cardTitle(media).title.slice(0, 1)}
      </span>
    )
  }
  return (
    <img
      key={source}
      className={styles.image}
      src={source}
      alt=""
      loading="lazy"
      decoding="async"
      onError={() => setFailed((current) => [...current, source])}
    />
  )
}
