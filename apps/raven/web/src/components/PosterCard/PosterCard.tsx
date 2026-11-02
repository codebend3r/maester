import {
  type ItemSummary,
  MATCH_STATES,
  type MatchItemType,
  type MediaItem,
  type MediaSort,
  cardLink,
  cardTitle,
  formatRuntime,
  mediaEntryKey,
  cardSortFact,
  watchLink,
} from '@raven/core'
import { CardLink } from '@/components/CardLink/CardLink'
import { FavouriteMark, FavouriteWords } from '@/components/FavouriteMark/FavouriteMark'
import { useCardMenu } from '@/components/MediaMenu/useCardMenu'
import { PlaybackNote } from '@/components/PlaybackNote/PlaybackNote'
import { PosterOverlay } from '@/components/PosterOverlay/PosterOverlay'
import { PosterImage } from '@/components/PosterImage/PosterImage'
import { PartlyWatched, ResumeBar } from '@/components/ResumeBar/ResumeBar'
import { SelectCheckbox } from '@/components/SelectCheckbox/SelectCheckbox'
import { WatchedMark, WatchedWords } from '@/components/WatchedMark/WatchedMark'
import type { PosterSizes } from '@/lib/posters'
import { useSelectable } from '@/lib/useSelectable'
import { POSTER_CARD_COPY } from '@/components/PosterCard/copy'
import styles from '@/components/PosterCard/PosterCard.module.scss'
import { COMMON_COPY } from '@/lib/copy'

type PosterFrameProps = {
  media: MediaItem
  poster?: ItemSummary | null
  sizes: PosterSizes
  /** Off where the card's note already says. */
  withWatched?: boolean
  /** On where the poster is large enough to carry the heart as well. */
  withFavourite?: boolean
}

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
}: PosterFrameProps) => (
  <span className={styles.frame}>
    <PosterImage media={media} poster={poster} sizes={sizes} />
    <ResumeBar media={media} className={styles.resume} />
    <span className={styles.marks}>
      {withFavourite && <FavouriteMark media={media} tone="overlay" decorative />}
      <WatchedMark decorative watched={withWatched && media.watched} />
    </span>
  </span>
)

type PosterCardProps = {
  media: MediaItem
  /** The item whose poster the card shows, when not the video's own: an episode's season. */
  poster?: ItemSummary | null
  /** How wide the list holding the card shows its poster. */
  sizes: PosterSizes
  /** What the library matches its files to, for the menu's Fix match. */
  matchType?: MatchItemType | null
  /** The order the listing is in, whose value the card shows. */
  sort?: MediaSort
}

/**
 * A movie as a poster, its title and facts beneath. A matched card opens the
 * movie's page and its play button plays at once; anything else opens the
 * player, as a frame-grab card does. A right click opens the card's menu.
 * Sorted, it shows the value its listing is sorted by above its facts. The
 * poster lifts toward the pointer, carrying its checkbox and menu with it.
 */
export const PosterCard = ({ media, matchType = null, sort, poster, sizes }: PosterCardProps) => {
  const menu = useCardMenu({ media, matchType })
  const { title, year } = cardTitle(media)
  const select = useSelectable({ key: mediaEntryKey(media), title })
  const link = cardLink({ media, hasPages: true })
  const hasPage = link.state == null
  const pageItem = hasPage ? (media.item?.id ?? null) : null
  const { sorted, isYearSaid } = cardSortFact({ media, sort })
  const facts = [
    year == null || isYearSaid ? null : String(year),
    media.versions > 1 ? POSTER_CARD_COPY.versions(media.versions) : null,
    year == null && media.versions === 1 ? formatRuntime(media.duration) : null,
    media.match === MATCH_STATES.unmatched ? COMMON_COPY.notMatched : null,
  ].filter((fact): fact is string => fact != null && fact !== sorted)

  return (
    <li
      className={`${styles.card} ${menu.hostClass}`}
      data-entry={mediaEntryKey(media)}
      {...select.rootProps}
    >
      <div className={styles.poster}>
        <CardLink
          {...link}
          prefetchItem={pageItem}
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
              ? { ...watchLink({ media }), label: POSTER_CARD_COPY.play(title) }
              : null
          }
        />
        {menu.menu}
      </div>
      <div className={styles.words}>
        <CardLink
          {...link}
          prefetchItem={pageItem}
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
          <FavouriteWords media={media} />
          <PartlyWatched media={media} />
          <WatchedWords watched={media.watched} />
        </span>
        <PlaybackNote media={media} />
      </div>
    </li>
  )
}
