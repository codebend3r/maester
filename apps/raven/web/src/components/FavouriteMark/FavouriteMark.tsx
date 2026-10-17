import type { MediaItem } from '@raven/core'
import { Icon } from '@raven/ui'
import styles from '@/components/FavouriteMark/FavouriteMark.module.scss'

/** The heart's word, for a screen reader; the heart itself is only a picture. */
export const FavouriteWords = ({ media }: { media: MediaItem }) =>
  media.favourite && <span className="visually-hidden">Favourite</span>

/**
 * A solid heart for a favourite; nothing for any other video. `inline` sits
 * beside a card's facts, `overlay` is a disc on glass over a poster, beside
 * the check, and `scrim` is the bare heart over a frame grab's dark foot.
 * It carries its own word, unless `decorative`: inside a picture hidden from
 * a screen reader, the card says it with `FavouriteWords` beside its facts.
 * Where it sits is the container's to say, so it takes a `className`.
 */
export const FavouriteMark = ({
  media,
  tone = 'inline',
  decorative = false,
  className,
}: {
  media: MediaItem
  tone?: 'inline' | 'overlay' | 'scrim'
  decorative?: boolean
  className?: string
}) =>
  media.favourite && (
    <span
      className={[styles.mark, styles[tone], className ?? ''].filter(Boolean).join(' ')}
      aria-hidden={decorative ? 'true' : undefined}
    >
      <Icon name="heart" size={tone === 'scrim' ? 18 : 14} />
      {!decorative && <FavouriteWords media={media} />}
    </span>
  )
