import {
  type ItemSummary,
  type MatchItemType,
  type MediaItem,
  type MediaSort,
  type RatingSource,
  cardTitle,
  formatRuntime,
  pickScore,
  sortFact,
} from '@raven/core'
import { CardLink } from '@/components/CardLink/CardLink'
import { FavouriteMark } from '@/components/FavouriteMark/FavouriteMark'
import { Icon } from '@raven/ui'
import { useCardMenu } from '@/components/MediaMenu/useCardMenu'
import { PlaybackNote } from '@/components/PlaybackNote/PlaybackNote'
import { PosterImage } from '@/components/PosterImage/PosterImage'
import { ScoreChip } from '@/components/RatingChips/RatingChips'
import { PartlyWatched, ResumeBar } from '@/components/ResumeBar/ResumeBar'
import { api } from '@/lib/api'
import { cardLink, watchLink } from '@/lib/itemLinks'
import { mediaEntryKey } from '@/lib/entryKeys'
import type { PosterSizes } from '@/lib/posters'
import { useHoverBackdrop } from '@/lib/useHoverBackdrop'
import styles from '@/components/PosterCard/PosterCard.module.scss'

/** The picture a poster card shows, with where playback stopped along its foot. */
export const PosterFrame = ({
  media,
  poster,
  sizes,
}: {
  media: MediaItem
  poster?: ItemSummary | null
  sizes: PosterSizes
}) => (
  <span className={styles.frame}>
    <PosterImage media={media} poster={poster} sizes={sizes} />
    <ResumeBar media={media} className={styles.resume} />
  </span>
)

const backdropOf = (item: ItemSummary | null | undefined): string | null =>
  item ? api.itemImageUrl({ id: item.id, kind: 'backdrop', version: item.backdropVersion }) : null

/**
 * A movie as a poster, its title and year beneath. A matched card opens the
 * movie's page and its play button plays at once; anything else opens the
 * player, as a frame-grab card does. A right click opens the card's menu.
 * Sorted, it shows the value its listing is sorted by above its facts.
 */
export const PosterCard = ({
  media,
  matchType = null,
  ratingsSource = 'tmdb',
  sort,
  poster,
  sizes,
}: {
  media: MediaItem
  /** The item whose poster the card shows, when not the video's own: an episode's season. */
  poster?: ItemSummary | null
  /** How wide the list holding the card shows its poster. */
  sizes: PosterSizes
  /** What the library matches its files to, for the menu's Fix match. */
  matchType?: MatchItemType | null
  /** Whose score the card shows, from the library's settings. */
  ratingsSource?: RatingSource
  /** The order the listing is in, whose value the card shows. */
  sort?: MediaSort
}) => {
  const menu = useCardMenu({ media, matchType })
  // The card's poster item's backdrop, else the video's own.
  const hover = useHoverBackdrop(backdropOf(poster) ?? backdropOf(media.item))
  const { title, year } = cardTitle(media)
  const score = media.item
    ? pickScore({ ratings: media.item.ratings, source: ratingsSource })
    : null
  const link = cardLink({ media, pages: true })
  const hasPage = link.state == null
  const sorted = sort ? sortFact({ media, sort }) : null
  const facts = [
    year == null ? null : String(year),
    media.versions > 1 ? `${media.versions} versions` : null,
    year == null && media.versions === 1 ? formatRuntime(media.duration) : null,
  ].filter((fact): fact is string => fact != null && fact !== sorted)

  return (
    <li className={`${styles.card} ${menu.hostClass}`} data-entry={mediaEntryKey(media)} {...hover}>
      <CardLink
        {...link}
        className={styles.picture}
        tabIndex={-1}
        aria-hidden="true"
        onContextMenu={menu.onContextMenu}
      >
        <PosterFrame media={media} poster={poster} sizes={sizes} />
      </CardLink>
      {hasPage && (
        <span className={styles.overlay}>
          <CardLink {...watchLink({ media })} className={styles.play} aria-label={`Play ${title}`}>
            <Icon name="play" size={18} />
          </CardLink>
        </span>
      )}
      <CardLink {...link} className={styles.title} onContextMenu={menu.onContextMenu}>
        {title}
      </CardLink>
      {sorted && <span className={styles.sorted}>{sorted}</span>}
      <span className={styles.facts}>
        <FavouriteMark media={media} />
        {facts.map((fact) => (
          <span key={fact}>{fact}</span>
        ))}
        {score && <ScoreChip rating={score} />}
        {media.match === 'unmatched' && <span>Not matched</span>}
        <PartlyWatched media={media} />
      </span>
      <PlaybackNote media={media} />
      {menu.menu}
    </li>
  )
}
