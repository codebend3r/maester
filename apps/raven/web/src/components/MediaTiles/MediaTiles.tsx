import {
  type ItemSummary,
  MATCH_STATES,
  type MatchItemType,
  type MediaItem,
  type MediaSort,
  cardLink,
  cardTitle,
  formatBytes,
  formatRuntime,
  mediaEntryKey,
  mediaLabel,
  pictureParts,
  cardSortFact,
} from '@raven/core'
import type { ComponentType } from 'react'
import { CardLink } from '@/components/CardLink/CardLink'
import { FavouriteMark } from '@/components/FavouriteMark/FavouriteMark'
import { useCardMenu } from '@/components/MediaMenu/useCardMenu'
import { PlaybackNote } from '@/components/PlaybackNote/PlaybackNote'
import { PosterFrame } from '@/components/PosterCard/PosterCard'
import { FactParts, FactText } from '@raven/ui'
import { PartlyWatched, ResumeBar } from '@/components/ResumeBar/ResumeBar'
import { SelectCheckbox } from '@/components/SelectCheckbox/SelectCheckbox'
import { Bone } from '@/components/Skeleton/Skeleton'
import { WatchedMark, WatchedWords } from '@/components/WatchedMark/WatchedMark'
import { api } from '@/lib/api'
import { POSTER_SIZES } from '@/lib/posters'
import { useSelectable } from '@/lib/useSelectable'
import { ViewportImage } from '@/components/ViewportImage/ViewportImage'
import { MEDIA_TILES_COPY } from '@/components/MediaTiles/copy'
import styles from '@/components/MediaTiles/MediaTiles.module.scss'
import { COMMON_COPY } from '@/lib/copy'

const PICTURE_KINDS = {
  poster: 'poster',
  thumbnail: 'thumbnail',
  placeholder: 'placeholder',
} as const
type PictureKind = (typeof PICTURE_KINDS)[keyof typeof PICTURE_KINDS]

type TilePictureProps = {
  media: MediaItem
  poster: ItemSummary | null
  thumbnail: string | null
  withWatched: boolean
}

type TilePosterProps = TilePictureProps

const TilePoster = ({ media, poster, withWatched }: TilePosterProps) => (
  <PosterFrame
    media={media}
    poster={poster ?? undefined}
    sizes={POSTER_SIZES.movieTile}
    withWatched={withWatched}
  />
)

type TileThumbnailProps = TilePictureProps

const TileThumbnail = ({ thumbnail }: TileThumbnailProps) => (
  <ViewportImage className={styles.thumbnail} src={thumbnail ?? ''} alt="" />
)

type TilePlaceholderProps = TilePictureProps

const TilePlaceholder = ({ media }: TilePlaceholderProps) => (
  <span className={styles.placeholder}>{media.title.slice(0, 1)}</span>
)

const TILE_PICTURES = {
  [PICTURE_KINDS.poster]: TilePoster,
  [PICTURE_KINDS.thumbnail]: TileThumbnail,
  [PICTURE_KINDS.placeholder]: TilePlaceholder,
} as const satisfies Record<PictureKind, ComponentType<TilePictureProps>>

type PictureKindOfProps = { isPoster: boolean; thumbnail: string | null }

const pictureKindOf = ({ isPoster, thumbnail }: PictureKindOfProps): PictureKind => {
  if (isPoster) return PICTURE_KINDS.poster
  if (thumbnail) return PICTURE_KINDS.thumbnail
  return PICTURE_KINDS.placeholder
}

type MediaTileProps = {
  media: MediaItem
  note: string | null
  posters: boolean
  /** The poster drawn in place of the frame grab: an episode's show's. */
  poster: ItemSummary | null
  withWatched: boolean
  matchType: MatchItemType | null
  sort: MediaSort | undefined
}

type ShownProps = { facts: ReadonlyArray<string | null>; sorted: string | null }

/** The facts worth a word: those with a value, less the one the sorted line says already. */
const shown = ({ facts, sorted }: ShownProps): string[] =>
  facts.filter((fact): fact is string => fact != null && fact !== '' && fact !== sorted)

/**
 * One video as a tile: a card with a small thumbnail, or a poster in a
 * Movies library, beside its facts, and its menu's button in the corner.
 * The words run title, release day, the picture's chips, then the runtime
 * and size, each on a line of its own.
 * The picture is a second way to the same place, so it stays out of the tab
 * order and the reading order; the title is the link. A right click on
 * either opens the tile's menu.
 */
const MediaTile = ({
  media,
  note,
  posters,
  poster,
  withWatched,
  matchType,
  sort,
}: MediaTileProps) => {
  const menu = useCardMenu({ media, matchType })
  const thumbnail = api.thumbnailUrl(media)
  const link = cardLink({ media, hasPages: posters })
  const { title, date } = cardTitle(media)
  const label = posters ? title : mediaLabel(media)
  const select = useSelectable({ key: mediaEntryKey(media), title: label })
  const { sorted, isDateSaid } = cardSortFact({ media, sort })
  const isPoster = posters || poster != null
  const TilePicture = TILE_PICTURES[pictureKindOf({ isPoster, thumbnail })]
  const released = shown({
    facts: [
      posters && !isDateSaid ? date : null,
      posters && media.versions > 1 ? MEDIA_TILES_COPY.versions(media.versions) : null,
    ],
    sorted,
  })
  const picture = pictureParts(media).filter((part) => part.text !== sorted)
  const facts = shown({ facts: [formatRuntime(media.duration), formatBytes(media.size)], sorted })

  return (
    <li
      className={[styles.tile, isPoster ? styles.posterTile : '', menu.hostClass]
        .filter(Boolean)
        .join(' ')}
      data-entry={mediaEntryKey(media)}
      {...select.rootProps}
    >
      <SelectCheckbox select={select} className={styles.select} />
      <CardLink
        {...link}
        className={isPoster ? styles.posterFrame : styles.frame}
        tabIndex={-1}
        aria-hidden="true"
        onContextMenu={menu.onContextMenu}
      >
        <TilePicture
          media={media}
          poster={poster}
          thumbnail={thumbnail}
          withWatched={withWatched}
        />
        {!isPoster && <ResumeBar media={media} className={styles.resume} />}
        {!isPoster && (
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
        {sorted && (
          <span className={styles.sorted}>
            <FactText fact={sorted} />
          </span>
        )}
        {released.length > 0 && (
          <span className={styles.facts}>
            {released.map((fact) => (
              <span key={fact} className={styles.fact}>
                {fact}
              </span>
            ))}
          </span>
        )}
        {picture.length > 0 && (
          <span className={styles.chips}>
            <FactParts parts={picture} />
          </span>
        )}
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
        {posters && media.match === MATCH_STATES.unmatched && (
          <span className={styles.note}>{COMMON_COPY.notMatched}</span>
        )}
        {note !== null && <span className={styles.note}>{note}</span>}
        <PlaybackNote media={media} />
      </div>
      {menu.menu}
    </li>
  )
}

type MediaTilesProps = {
  items: MediaItem[]
  note?: (media: MediaItem) => string | null
  /** A Movies library's tiles: small posters, opening the movie's page. */
  posters?: boolean
  /** A poster to draw in place of a video's frame grab, such as its show's; none keeps the frame. */
  posterOf?: (media: MediaItem) => ItemSummary | null
  /** Off for the history, whose notes say what was watched. */
  withWatched?: boolean
  /** What the library matches its files to, for the menu's Fix match. */
  matchType?: MatchItemType | null
  /** The order the listing is in, whose value each tile shows first. */
  sort?: MediaSort
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
  posterOf,
  withWatched = true,
  matchType = null,
  sort,
}: MediaTilesProps) => (
  <ul className={styles.tiles}>
    {items.map((item) => (
      <MediaTile
        key={item.id}
        media={item}
        note={note ? note(item) : null}
        posters={posters}
        poster={posterOf?.(item) ?? null}
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

type MediaTilesSkeletonProps = { count?: number }

/** The tiles while they are on their way, as tiles of stand-ins; a list stands in the same. */
export const MediaTilesSkeleton = ({ count = 6 }: MediaTilesSkeletonProps) => (
  <ul className={styles.tiles}>
    {Array.from({ length: count }, (_, index) => (
      <TileSkeleton key={index} />
    ))}
  </ul>
)
