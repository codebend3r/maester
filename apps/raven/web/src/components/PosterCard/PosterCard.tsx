import {
  type ItemSummary,
  MATCH_STATES,
  type MatchItemType,
  type MediaItem,
  type MediaSort,
  type RatingSource,
  cardLink,
  cardTitle,
  formatRuntime,
  mediaEntryKey,
  pickScore,
  sortFact,
  watchLink,
} from '@raven/core'
import { RatingBadge } from '@/components/RatingPanel/RatingPanel'
import { CardLink } from '@/components/CardLink/CardLink'
import { FavouriteMark, FavouriteWords } from '@/components/FavouriteMark/FavouriteMark'
import { useCardMenu } from '@/components/MediaMenu/useCardMenu'
import { PlaybackNote } from '@/components/PlaybackNote/PlaybackNote'
import { PosterOverlay } from '@/components/PosterOverlay/PosterOverlay'
import { PosterImage } from '@/components/PosterImage/PosterImage'
import { PartlyWatched, ResumeBar } from '@/components/ResumeBar/ResumeBar'
import { SelectCheckbox } from '@/components/SelectCheckbox/SelectCheckbox'
import { WatchedMark, WatchedWords } from '@/components/WatchedMark/WatchedMark'
import { api } from '@/lib/api'
import type { PosterSizes } from '@/lib/posters'
import { useHoverBackdrop } from '@/lib/useHoverBackdrop'
import { useSelectable } from '@/lib/useSelectable'
import styles from '@/components/PosterCard/PosterCard.module.scss'

/**
 * The picture a poster card shows, with where playback stopped along its
 * foot and its marks in the top corner: the heart for a favourite, then the
 * check when it is watched. A rewatch has both the check and the line.
 */
export const PosterFrame = ({
  media,
  poster,
  sizes,
  withWatched = true,
  withFavourite = false,
}: {
  media: MediaItem
  poster?: ItemSummary | null
  sizes: PosterSizes
  /** Off where the card's note already says. */
  withWatched?: boolean
  /** On where the poster is large enough to carry the heart as well. */
  withFavourite?: boolean
}) => (
  <span className={styles.frame}>
    <PosterImage media={media} poster={poster} sizes={sizes} />
    <ResumeBar media={media} className={styles.resume} />
    <span className={styles.marks}>
      {withFavourite && <FavouriteMark media={media} tone="overlay" decorative />}
      <WatchedMark decorative watched={withWatched && media.watched} />
    </span>
  </span>
)

const backdropOf = (item: ItemSummary | null | undefined): string | null =>
  item ? api.itemImageUrl({ id: item.id, kind: 'backdrop', version: item.backdropVersion }) : null

/**
 * A movie as a poster, its title and facts beneath. A matched card opens the
 * movie's page and its play button plays at once; anything else opens the
 * player, as a frame-grab card does. A right click opens the card's menu.
 * Sorted, it shows the value its listing is sorted by above its facts. The
 * poster lifts toward the pointer, carrying its checkbox and menu with it.
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
  const select = useSelectable({ key: mediaEntryKey(media), title })
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
    media.match === MATCH_STATES.unmatched ? 'Not matched' : null,
  ].filter((fact): fact is string => fact != null && fact !== sorted)

  return (
    <li
      className={`${styles.card} ${menu.hostClass}`}
      data-entry={mediaEntryKey(media)}
      {...hover}
      {...select.rootProps}
    >
      <div className={styles.poster}>
        <CardLink
          {...link}
          className={styles.picture}
          tabIndex={-1}
          aria-hidden="true"
          onContextMenu={menu.onContextMenu}
        >
          <PosterFrame media={media} poster={poster} sizes={sizes} withFavourite />
        </CardLink>
        <SelectCheckbox select={select} className={styles.select} />
        <PosterOverlay
          media={media}
          play={
            hasPage && !select.selecting
              ? { ...watchLink({ media }), label: `Play ${title}` }
              : null
          }
        />
        {menu.menu}
      </div>
      <div className={styles.words}>
        <CardLink
          {...link}
          className={styles.title}
          tabIndex={select.linkTabIndex}
          onContextMenu={menu.onContextMenu}
        >
          {title}
        </CardLink>
        {sorted && <span className={styles.sorted}>{sorted}</span>}
        <span className={styles.facts}>
          {facts.map((fact) => (
            <span key={fact} className={styles.fact}>
              {fact}
            </span>
          ))}
          {score && (
            <span className={styles.fact}>
              <RatingBadge rating={score} />
            </span>
          )}
          <FavouriteWords media={media} />
          <PartlyWatched media={media} />
          <WatchedWords watched={media.watched} />
        </span>
        <PlaybackNote media={media} />
      </div>
    </li>
  )
}
