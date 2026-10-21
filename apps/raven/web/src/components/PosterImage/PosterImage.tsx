import { type ItemSummary, type MediaItem, cardTitle } from '@raven/core'
import { useState } from 'react'
import { api } from '@/lib/api'
import { type PosterSizes, posterSources } from '@/lib/posters'
import { ViewportImage } from '@/components/ViewportImage/ViewportImage'
import styles from '@/components/PosterImage/PosterImage.module.scss'

type Source = NonNullable<ReturnType<typeof posterSources>>

/**
 * The first of `sources` that loads, else `initial`, dim in the middle. A
 * picture that fails to load gives way to the next. The frame is the
 * container's to give.
 */
const Picture = ({ sources, initial }: { sources: Source[]; initial: string }) => {
  const [failed, setFailed] = useState<ReadonlyArray<string>>([])
  const source = sources.find(({ src }) => !failed.includes(src))
  if (!source) {
    return (
      <span className={styles.placeholder} aria-hidden="true">
        {initial}
      </span>
    )
  }
  return (
    <ViewportImage
      key={source.src}
      className={styles.image}
      {...source}
      alt=""
      onError={() => setFailed((current) => [...current, source.src])}
    />
  )
}

/**
 * A video's poster, else its frame grab cropped to the frame, else its
 * title's first letter. The poster is the video's own item's unless
 * `poster` names another, as an episode shows its season's. `sizes` says
 * how wide the container shows it, so the browser fetches a poster no
 * wider than that.
 */
export const PosterImage = ({
  media,
  poster = media.item,
  sizes,
}: {
  media: MediaItem
  poster?: ItemSummary | null
  sizes: PosterSizes
}) => {
  const thumbnail = api.thumbnailUrl(media)
  const sources = [
    poster ? posterSources({ item: poster, sizes }) : null,
    thumbnail == null ? null : { src: thumbnail },
  ].filter((source): source is Source => source != null)
  return <Picture sources={sources} initial={cardTitle(media).title.slice(0, 1)} />
}

/** An item's own poster, as a show's card shows it, else its title's first letter. */
export const ItemPoster = ({ item, sizes }: { item: ItemSummary; sizes: PosterSizes }) => {
  const poster = posterSources({ item, sizes })
  return <Picture sources={poster ? [poster] : []} initial={item.title.slice(0, 1)} />
}
