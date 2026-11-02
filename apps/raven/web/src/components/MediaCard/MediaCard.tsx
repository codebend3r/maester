import {
  type MatchItemType,
  type MediaAlbum,
  type MediaItem,
  type MediaSort,
  cardLink,
  codecLabel,
  formatBytes,
  formatRuntime,
  mediaEntryKey,
  mediaLabel,
  resolutionLabel,
  sortFact,
  timeLeftOf,
  watchLink,
} from '@raven/core'
import { Icon } from '@raven/ui'
import type { ComponentType } from 'react'
import { AlbumCover } from '@/components/AlbumCover/AlbumCover'
import { CardLink } from '@/components/CardLink/CardLink'
import { FavouriteMark, FavouriteWords } from '@/components/FavouriteMark/FavouriteMark'
import { useCardMenu } from '@/components/MediaMenu/useCardMenu'
import { PlaybackNote } from '@/components/PlaybackNote/PlaybackNote'
import { FactText, PictureChip, ResolutionChip } from '@/components/ResolutionChip/ResolutionChip'
import { PartlyWatched, ResumeBar } from '@/components/ResumeBar/ResumeBar'
import { SelectCheckbox } from '@/components/SelectCheckbox/SelectCheckbox'
import { WatchedMark, WatchedWords } from '@/components/WatchedMark/WatchedMark'
import { api } from '@/lib/api'
import { POSTER_SIZES } from '@/lib/posters'
import { useSelectable } from '@/lib/useSelectable'
import { ViewportImage } from '@/components/ViewportImage/ViewportImage'
import { MEDIA_CARD_COPY } from '@/components/MediaCard/copy'
import styles from '@/components/MediaCard/MediaCard.module.scss'
import { COMMON_COPY } from '@/lib/copy'

const FRAME_KINDS = {
  cover: 'cover',
  thumbnail: 'thumbnail',
  placeholder: 'placeholder',
} as const
type FrameKind = (typeof FRAME_KINDS)[keyof typeof FRAME_KINDS]

type FramePictureProps = { thumbnail: string | null; label: string; album: MediaAlbum | null }

type FrameThumbnailProps = FramePictureProps

const FrameThumbnail = ({ thumbnail }: FrameThumbnailProps) => (
  <ViewportImage className={styles.thumbnail} src={thumbnail ?? ''} alt="" />
)

type FrameCoverProps = FramePictureProps

/** A music file's frame is its album's cover, square like every cover. */
const FrameCover = ({ album, label }: FrameCoverProps) => (
  <AlbumCover
    album={{
      id: album?.id ?? 0,
      title: album?.title ?? label,
      coverVersion: album?.coverVersion ?? null,
    }}
    sizes={POSTER_SIZES.grid}
  />
)

type FramePlaceholderProps = FramePictureProps

const FramePlaceholder = ({ label }: FramePlaceholderProps) => (
  <span className={styles.placeholder} aria-hidden="true">
    {label.slice(0, 1)}
  </span>
)

const FRAME_PICTURES = {
  [FRAME_KINDS.cover]: FrameCover,
  [FRAME_KINDS.thumbnail]: FrameThumbnail,
  [FRAME_KINDS.placeholder]: FramePlaceholder,
} as const satisfies Record<FrameKind, ComponentType<FramePictureProps>>

type FrameKindOfProps = { album: MediaAlbum | null; thumbnail: string | null }

const frameKindOf = ({ album, thumbnail }: FrameKindOfProps): FrameKind => {
  if (album !== null) return FRAME_KINDS.cover
  return thumbnail ? FRAME_KINDS.thumbnail : FRAME_KINDS.placeholder
}

type MediaCardProps = {
  media: MediaItem
  /** What the library matches its files to, for the menu's Fix match. */
  matchType?: MatchItemType | null
  /** The order the listing is in, whose value the card shows. */
  sort?: MediaSort
}

/**
 * One video in the grid, as its frame grab: its resolution and HDR on glass
 * in one top corner, the check in the other, and over a dark foot how long
 * is left beside the heart, over the resume line. The picture plays it,
 * handing the item to the player through router state so playback starts
 * without waiting on another request. The title opens the page of the movie
 * or episode the file is; with no such page, it plays too, and the picture
 * is a second way there. A right click on either, or the button in the
 * corner, opens the card's menu. Sorted, it shows the value its listing is
 * sorted by above its facts, and says that value nowhere else.
 */
export const MediaCard = ({ media, matchType = null, sort }: MediaCardProps) => {
  const menu = useCardMenu({ media, matchType })
  const thumbnail = api.thumbnailUrl(media)
  const label = mediaLabel(media)
  const select = useSelectable({ key: mediaEntryKey(media), title: label })
  const play = watchLink({ media })
  const page = cardLink({ media, hasPages: true })
  const hasPage = page.state == null
  const sorted = sort ? sortFact({ media, sort }) : null
  const timeLeft = timeLeftOf(media)
  // A listing sorted by resolution says it under the title, so the corner leaves it out.
  const resolution = resolutionLabel(media)
  const cornerResolution = resolution === sorted ? null : resolution
  const frameKind = frameKindOf({ album: media.album, thumbnail })
  const FramePicture = FRAME_PICTURES[frameKind]
  const facts = [
    formatRuntime(media.duration),
    media.videoCodec ? codecLabel(media.videoCodec) : null,
    formatBytes(media.size),
  ].filter((fact): fact is string => fact != null && fact !== sorted)

  return (
    <li
      className={`${styles.card} ${menu.hostClass}`}
      data-entry={mediaEntryKey(media)}
      {...select.rootProps}
    >
      <div className={styles.picture}>
        <CardLink
          {...play}
          className={styles.link}
          onContextMenu={menu.onContextMenu}
          {...(hasPage
            ? { 'aria-label': MEDIA_CARD_COPY.play(label), tabIndex: select.linkTabIndex }
            : { 'aria-hidden': true, tabIndex: -1 })}
        >
          <span
            className={
              frameKind === FRAME_KINDS.cover ? `${styles.frame} ${styles.square}` : styles.frame
            }
          >
            <FramePicture thumbnail={thumbnail} label={label} album={media.album} />
            <span className={styles.scrim} />
            {timeLeft && (
              <span className={styles.left}>
                <span className={styles.disc}>
                  <Icon name="play" size={12} />
                </span>
                {timeLeft}
              </span>
            )}
            <FavouriteMark media={media} tone="scrim" decorative className={styles.heart} />
            <ResumeBar media={media} className={styles.resume} />
            <WatchedMark decorative watched={media.watched} className={styles.watched} />
          </span>
        </CardLink>
        {(cornerResolution != null || media.hdr) && (
          <span className={styles.badges}>
            <ResolutionChip resolution={cornerResolution} />
            {media.hdr && <PictureChip label={COMMON_COPY.hdr}>{COMMON_COPY.hdr}</PictureChip>}
          </span>
        )}
        <SelectCheckbox select={select} className={styles.select} />
        {menu.menu}
      </div>
      <div className={styles.words}>
        <CardLink
          {...(hasPage ? page : play)}
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
