import {
  MATCH_STATES,
  type MatchItemType,
  type MediaItem,
  type MediaSort,
  cardTitle,
  codecLabel,
  formatBytes,
  formatRuntime,
  mediaLabel,
  resolutionLabel,
  sortFact,
} from '@raven/core'
import { RatingBadge } from '@/components/RatingPanel/RatingPanel'
import { CardLink } from '@/components/CardLink/CardLink'
import { FavouriteMark } from '@/components/FavouriteMark/FavouriteMark'
import { useCardMenu } from '@/components/MediaMenu/useCardMenu'
import { PlaybackNote } from '@/components/PlaybackNote/PlaybackNote'
import { PosterFrame } from '@/components/PosterCard/PosterCard'
import { PartlyWatched, ResumeBar } from '@/components/ResumeBar/ResumeBar'
import { SelectCheckbox } from '@/components/SelectCheckbox/SelectCheckbox'
import { Bone } from '@/components/Skeleton/Skeleton'
import { WatchedMark, WatchedWords } from '@/components/WatchedMark/WatchedMark'
import { api } from '@/lib/api'
import { cardLink } from '@/lib/itemLinks'
import { POSTER_SIZES } from '@/lib/posters'
import { mediaEntryKey } from '@/lib/entryKeys'
import { useSelectable } from '@/lib/useSelectable'
import styles from '@/components/MediaTiles/MediaTiles.module.scss'

/**
 * One video as a tile: a card with a small thumbnail, or a small poster in
 * a Movies library, beside its facts, and its menu's button in the corner.
 * The picture is a second way to the same place, so it stays out of the tab
 * order and the reading order; the title is the link. A right click on
 * either opens the tile's menu.
 */
const MediaTile = ({
  media,
  note,
  posters,
  withWatched,
  matchType,
  sort,
}: {
  media: MediaItem
  note: string | null
  posters: boolean
  withWatched: boolean
  matchType: MatchItemType | null
  sort: MediaSort | undefined
}) => {
  const menu = useCardMenu({ media, matchType })
  const thumbnail = api.thumbnailUrl(media)
  const link = cardLink({ media, pages: posters })
  const { year } = cardTitle(media)
  const label = posters ? cardTitle(media).title : mediaLabel(media)
  const select = useSelectable({ key: mediaEntryKey(media), title: label })
  const sorted = sort ? sortFact({ media, sort }) : null
  const facts = [
    posters && year != null ? String(year) : null,
    posters && media.versions > 1 ? `${media.versions} versions` : null,
    formatRuntime(media.duration),
    resolutionLabel(media),
    media.hdr ? 'HDR' : null,
    media.videoCodec ? codecLabel(media.videoCodec) : null,
    formatBytes(media.size),
  ].filter((fact): fact is string => fact != null && fact !== sorted)

  return (
    <li
      className={[styles.tile, posters ? styles.posterTile : '', menu.hostClass]
        .filter(Boolean)
        .join(' ')}
      data-entry={mediaEntryKey(media)}
      {...select.rootProps}
    >
      <SelectCheckbox select={select} className={styles.select} />
      <CardLink
        {...link}
        className={posters ? styles.posterFrame : styles.frame}
        tabIndex={-1}
        aria-hidden="true"
        onContextMenu={menu.onContextMenu}
      >
        {posters ? (
          <PosterFrame media={media} sizes={POSTER_SIZES.movieTile} withWatched={withWatched} />
        ) : thumbnail ? (
          <img
            className={styles.thumbnail}
            src={thumbnail}
            alt=""
            loading="lazy"
            decoding="async"
          />
        ) : (
          <span className={styles.placeholder}>{media.title.slice(0, 1)}</span>
        )}
        {!posters && <ResumeBar media={media} className={styles.resume} />}
        {!posters && (
          <WatchedMark
            decorative
            watched={withWatched && media.watched}
            className={styles.watched}
          />
        )}
      </CardLink>
      <div className={styles.body}>
        <CardLink
          {...link}
          className={styles.title}
          tabIndex={select.linkTabIndex}
          onContextMenu={menu.onContextMenu}
        >
          {label}
        </CardLink>
        {sorted && <span className={styles.sorted}>{sorted}</span>}
        <span className={styles.facts}>
          {media.favourite && (
            <span className={styles.fact}>
              <FavouriteMark media={media} />
            </span>
          )}
          {facts.map((fact) => (
            <span key={fact} className={styles.fact}>
              {fact}
            </span>
          ))}
          <PartlyWatched media={media} />
          <WatchedWords watched={withWatched && media.watched} />
        </span>
        {posters && media.item && media.item.ratings.length > 0 && (
          <ul className={styles.scores} aria-label="Ratings">
            {media.item.ratings.map((rating) => (
              <li key={rating.source}>
                <RatingBadge rating={rating} />
              </li>
            ))}
          </ul>
        )}
        {media.folder !== '' && <span className={styles.folder}>{media.folder}</span>}
        {posters && media.match === MATCH_STATES.unmatched && (
          <span className={styles.note}>Not matched</span>
        )}
        {note !== null && <span className={styles.note}>{note}</span>}
        <PlaybackNote media={media} />
      </div>
      {menu.menu}
    </li>
  )
}

/**
 * Every video as a tile, a card with a small thumbnail beside its facts, as
 * many side by side as fit. `note` adds a line of the caller's own under a
 * video, as the history does.
 */
export const MediaTiles = ({
  items,
  note,
  posters = false,
  withWatched = true,
  matchType = null,
  sort,
}: {
  items: MediaItem[]
  note?: (media: MediaItem) => string | null
  /** A Movies library's tiles: small posters, opening the movie's page. */
  posters?: boolean
  /** Off for the history, whose notes say what was watched. */
  withWatched?: boolean
  /** What the library matches its files to, for the menu's Fix match. */
  matchType?: MatchItemType | null
  /** The order the listing is in, whose value each tile shows first. */
  sort?: MediaSort
}) => (
  <ul className={styles.tiles}>
    {items.map((item) => (
      <MediaTile
        key={item.id}
        media={item}
        note={note ? note(item) : null}
        posters={posters}
        withWatched={withWatched}
        matchType={matchType}
        sort={sort}
      />
    ))}
  </ul>
)

/** A tile on its way, laid out as a tile: its frame grab's place, a line for its title and one for its facts. */
const TileSkeleton = () => (
  <li className={styles.tile}>
    <span className={styles.frame}>
      <Bone shape="fill" />
    </span>
    <div className={styles.body}>
      <Bone shape="text" width="most" />
      <Bone shape="small" width="half" />
    </div>
  </li>
)

/** The tiles while they are on their way, as tiles of stand-ins; a list stands in the same. */
export const MediaTilesSkeleton = ({ count = 6 }: { count?: number }) => (
  <ul className={styles.tiles}>
    {Array.from({ length: count }, (_, index) => (
      <TileSkeleton key={index} />
    ))}
  </ul>
)
