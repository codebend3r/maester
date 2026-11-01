import { type ItemSummary, type MediaItem, cardTitle } from '@raven/core'
import { type ComponentType, useState } from 'react'
import { api } from '@/lib/api'
import { type PosterSizes, posterSources } from '@/lib/posters'
import { ViewportImage } from '@/components/ViewportImage/ViewportImage'
import styles from '@/components/PosterImage/PosterImage.module.scss'

type Source = NonNullable<ReturnType<typeof posterSources>>

/** Whether a source is left to load, or every one failed and the initial stands in. */
const PICTURE_STATES = { image: 'image', initial: 'initial' } as const

type PictureState = (typeof PICTURE_STATES)[keyof typeof PICTURE_STATES]

type PictureViewProps = {
  source: Source | undefined
  initial: string
  onFail: (src: string) => void
}

type PictureLetterProps = { initial: string; isWaiting: boolean }

/**
 * The first letter, dead center in the frame. Once there is no picture it is the
 * frame's text; while one is on its way it is drawn from `data-initial` on the
 * shimmering stand-in, which no reader or test takes for the card's own words.
 */
const PictureLetter = ({ initial, isWaiting }: PictureLetterProps) =>
  isWaiting ? (
    <span
      className={`${styles.placeholder} ${styles.waiting}`}
      data-initial={initial}
      aria-hidden="true"
    />
  ) : (
    <span className={styles.placeholder} aria-hidden="true">
      {initial}
    </span>
  )

type PictureImageProps = PictureViewProps

/** The picture fades in over its stand-in once it has arrived. */
const PictureImage = ({ source, initial, onFail }: PictureImageProps) => {
  const [isLoaded, setLoaded] = useState(false)
  return (
    <span className={styles.stack} aria-hidden="true">
      <PictureLetter initial={initial} isWaiting={!isLoaded} />
      {source !== undefined && (
        <ViewportImage
          key={source.src}
          className={isLoaded ? `${styles.image} ${styles.loaded}` : styles.image}
          {...source}
          alt=""
          onLoad={() => setLoaded(true)}
          onError={() => onFail(source.src)}
        />
      )}
    </span>
  )
}

type PictureInitialProps = PictureViewProps

const PictureInitial = ({ initial }: PictureInitialProps) => (
  <PictureLetter initial={initial} isWaiting={false} />
)

const PICTURE_VIEWS = {
  [PICTURE_STATES.image]: PictureImage,
  [PICTURE_STATES.initial]: PictureInitial,
} as const satisfies Record<PictureState, ComponentType<PictureViewProps>>

type PictureProps = { sources: Source[]; initial: string }

/**
 * The first of `sources` that loads, else `initial`, dim in the middle. A
 * picture that fails to load gives way to the next. The frame is the
 * container's to give: a poster's, a frame grab's or an album cover's.
 */
export const Picture = ({ sources, initial }: PictureProps) => {
  const [failed, setFailed] = useState<ReadonlyArray<string>>([])
  const source = sources.find(({ src }) => !failed.includes(src))
  const View: ComponentType<PictureViewProps> =
    PICTURE_VIEWS[source === undefined ? PICTURE_STATES.initial : PICTURE_STATES.image]
  return (
    <View
      key={source?.src}
      source={source}
      initial={initial}
      onFail={(src) => setFailed((current) => [...current, src])}
    />
  )
}

type PosterImageProps = {
  media: MediaItem
  poster?: ItemSummary | null
  sizes: PosterSizes
}

/**
 * A video's poster, else its frame grab cropped to the frame, else its
 * title's first letter. The poster is the video's own item's unless
 * `poster` names another, as an episode shows its season's. `sizes` says
 * how wide the container shows it, so the browser fetches a poster no
 * wider than that.
 */
export const PosterImage = ({ media, poster = media.item, sizes }: PosterImageProps) => {
  const thumbnail = api.thumbnailUrl(media)
  const sources = [
    poster ? posterSources({ item: poster, sizes }) : null,
    thumbnail == null ? null : { src: thumbnail },
  ].filter((source): source is Source => source != null)
  return <Picture sources={sources} initial={cardTitle(media).title.slice(0, 1)} />
}

type ItemPosterProps = { item: ItemSummary; sizes: PosterSizes }

/** An item's own poster, as a show's card shows it, else its title's first letter. */
export const ItemPoster = ({ item, sizes }: ItemPosterProps) => {
  const poster = posterSources({ item, sizes })
  return <Picture sources={poster ? [poster] : []} initial={item.title.slice(0, 1)} />
}
