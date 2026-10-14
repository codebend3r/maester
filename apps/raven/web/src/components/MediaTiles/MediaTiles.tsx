import {
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
import { CardLink } from '@/components/CardLink/CardLink'
import { FavouriteMark } from '@/components/FavouriteMark/FavouriteMark'
import { useCardMenu } from '@/components/MediaMenu/useCardMenu'
import { PlaybackNote } from '@/components/PlaybackNote/PlaybackNote'
import { PosterFrame } from '@/components/PosterCard/PosterCard'
import { RatingChips } from '@/components/RatingChips/RatingChips'
import { PartlyWatched, ResumeBar } from '@/components/ResumeBar/ResumeBar'
import { Bone } from '@/components/Skeleton/Skeleton'
import { api } from '@/lib/api'
import { cardLink } from '@/lib/itemLinks'
import { POSTER_SIZES } from '@/lib/posters'
import { mediaEntryKey } from '@/lib/entryKeys'
import styles from '@/components/MediaTiles/MediaTiles.module.scss'

/**
 * One video as a row with a small thumbnail, or a small poster in a Movies
 * library. The picture is a second way to the same place, so it stays out
 * of the tab order and the reading order; the title is the link. A right
 * click on either opens the row's menu.
 */
const MediaTile = ({
  media,
  note,
  posters,
  matchType,
  sort,
}: {
  media: MediaItem
  note: string | null
  posters: boolean
  matchType: MatchItemType | null
  sort: MediaSort | undefined
}) => {
  const menu = useCardMenu({ media, matchType, inline: true })
  const thumbnail = api.thumbnailUrl(media)
  const link = cardLink({ media, pages: posters })
  const { year } = cardTitle(media)
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
    >
      <CardLink
        {...link}
        className={posters ? styles.posterFrame : styles.frame}
        tabIndex={-1}
        aria-hidden="true"
        onContextMenu={menu.onContextMenu}
      >
        {posters ? (
          <PosterFrame media={media} sizes={POSTER_SIZES.movieTile} />
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
      </CardLink>
      <div className={styles.body}>
        <CardLink {...link} className={styles.title} onContextMenu={menu.onContextMenu}>
          {posters ? cardTitle(media).title : mediaLabel(media)}
        </CardLink>
        {sorted && <span className={styles.sorted}>{sorted}</span>}
        <span className={styles.facts}>
          <FavouriteMark media={media} />
          {facts.map((fact) => (
            <span key={fact}>{fact}</span>
          ))}
          <PartlyWatched media={media} />
        </span>
        {posters && media.item && <RatingChips ratings={media.item.ratings} />}
        {media.folder !== '' && <span className={styles.folder}>{media.folder}</span>}
        {posters && media.match === 'unmatched' && <span className={styles.note}>Not matched</span>}
        {note !== null && <span className={styles.note}>{note}</span>}
        <PlaybackNote media={media} />
      </div>
      {menu.menu}
    </li>
  )
}

/**
 * Every video as a taller row with a small thumbnail beside its facts.
 * `note` adds a line of the caller's own under a video, as the history does.
 */
export const MediaTiles = ({
  items,
  note,
  posters = false,
  matchType = null,
  sort,
}: {
  items: MediaItem[]
  note?: (media: MediaItem) => string | null
  /** A Movies library's tiles: small posters, opening the movie's page. */
  posters?: boolean
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
      <Bone shape="text" width="half" />
      <Bone shape="small" width="short" />
    </div>
  </li>
)

/** The tiles while they are on their way, as rows of stand-ins; a list stands in the same. */
export const MediaTilesSkeleton = ({ count = 6 }: { count?: number }) => (
  <ul className={styles.tiles}>
    {Array.from({ length: count }, (_, index) => (
      <TileSkeleton key={index} />
    ))}
  </ul>
)
