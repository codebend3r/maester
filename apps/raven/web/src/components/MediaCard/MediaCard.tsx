import {
  type MatchItemType,
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
import { CardLink } from '@/components/CardLink/CardLink'
import { FavouriteMark, FavouriteWords } from '@/components/FavouriteMark/FavouriteMark'
import { useCardMenu } from '@/components/MediaMenu/useCardMenu'
import { PlaybackNote } from '@/components/PlaybackNote/PlaybackNote'
import { PictureChip } from '@/components/ResolutionChip/ResolutionChip'
import { PartlyWatched, ResumeBar } from '@/components/ResumeBar/ResumeBar'
import { SelectCheckbox } from '@/components/SelectCheckbox/SelectCheckbox'
import { WatchedMark, WatchedWords } from '@/components/WatchedMark/WatchedMark'
import { api } from '@/lib/api'
import { useSelectable } from '@/lib/useSelectable'
import { ViewportImage } from '@/components/ViewportImage/ViewportImage'
import styles from '@/components/MediaCard/MediaCard.module.scss'

/** A label on glass over the frame grab, with the words a screen reader hears for it. */
type Badge = { text: string; label: string }

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
  const resolution = resolutionLabel(media)
  const badges = [
    resolution == null ? null : { text: resolution, label: `Video resolution: ${resolution}` },
    media.hdr ? { text: 'HDR', label: 'HDR' } : null,
  ].filter((badge): badge is Badge => badge != null && badge.text !== sorted)
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
            ? { 'aria-label': `Play ${label}`, tabIndex: select.linkTabIndex }
            : { 'aria-hidden': true, tabIndex: -1 })}
        >
          <span className={styles.frame}>
            {thumbnail ? (
              <ViewportImage className={styles.thumbnail} src={thumbnail} alt="" />
            ) : (
              <span className={styles.placeholder} aria-hidden="true">
                {label.slice(0, 1)}
              </span>
            )}
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
        {badges.length > 0 && (
          <span className={styles.badges}>
            {badges.map((badge) => (
              <PictureChip key={badge.text} label={badge.label}>
                {badge.text}
              </PictureChip>
            ))}
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
