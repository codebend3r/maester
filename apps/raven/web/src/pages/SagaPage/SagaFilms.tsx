import {
  type MediaItem,
  type RatingSource,
  cardTitle,
  formatRuntime,
  pickScore,
  resolutionLabel,
} from '@raven/core'
import { Icon } from '@raven/ui'
import { CardLink } from '@/components/CardLink/CardLink'
import { FavouriteMark } from '@/components/FavouriteMark/FavouriteMark'
import { Dotted } from '@/components/ItemHeader/ItemHeader'
import { useCardMenu } from '@/components/MediaMenu/useCardMenu'
import { PlaybackNote } from '@/components/PlaybackNote/PlaybackNote'
import { PosterFrame } from '@/components/PosterCard/PosterCard'
import { ScoreChip } from '@/components/RatingChips/RatingChips'
import { PartlyWatched } from '@/components/ResumeBar/ResumeBar'
import { SelectCheckbox } from '@/components/SelectCheckbox/SelectCheckbox'
import { mediaEntryKey } from '@/lib/entryKeys'
import { cardLink, watchLink } from '@/lib/itemLinks'
import { POSTER_SIZES } from '@/lib/posters'
import { useSelectable } from '@/lib/useSelectable'
import styles from '@/pages/SagaPage/SagaFilms.module.scss'

/** Where a movie stands in the saga: watched, the one to watch next, or neither. */
type Standing = 'watched' | 'next' | 'later'

const TAGS = {
  watched: { label: 'Watched', className: styles.watchedTag },
  next: { label: 'Up next', className: styles.nextTag },
  later: null,
} as const satisfies Record<Standing, { label: string; className: string | undefined } | null>

/** Each movie's standing: the watched ones, then the first not watched is up next. */
export const standings = (media: readonly MediaItem[]): Standing[] => {
  const next = media.findIndex((each) => !each.watched)
  return media.map((each, index) => {
    if (each.watched) return 'watched'
    return index === next ? 'next' : 'later'
  })
}

/** "2001 · 2h 58m · 4K HDR": the year, how long it runs, and its picture. */
const filmFacts = (media: MediaItem): string[] => {
  const { year } = cardTitle(media)
  const resolution = resolutionLabel(media)
  return [
    year == null ? null : String(year),
    formatRuntime(media.duration),
    resolution && (media.hdr ? `${resolution} HDR` : resolution),
    media.versions > 1 ? `${media.versions} versions` : null,
  ].filter((fact): fact is string => fact != null)
}

/**
 * One movie of the saga on a row: its place in the order in large serif
 * figures (dim once watched), its poster, title, facts and score, whether
 * it is watched or up next, and a round button that plays it. The title opens
 * its page; a right click opens its menu; in select mode a click anywhere
 * on the row selects it.
 */
const SagaFilm = ({
  media,
  place,
  standing,
  ratingsSource,
}: {
  media: MediaItem
  place: number
  standing: Standing
  ratingsSource: RatingSource
}) => {
  const menu = useCardMenu({ media, matchType: 'movie', inline: true })
  const { title } = cardTitle(media)
  const select = useSelectable({ key: mediaEntryKey(media), title })
  const link = cardLink({ media, pages: true })
  const hasPage = link.state == null
  const tag = TAGS[standing]
  const score = media.item
    ? pickScore({ ratings: media.item.ratings, source: ratingsSource })
    : null
  return (
    <li
      className={[styles.film, menu.hostClass, standing === 'watched' ? styles.seen : '']
        .filter(Boolean)
        .join(' ')}
      data-entry={mediaEntryKey(media)}
      {...select.rootProps}
    >
      <span className={styles.place} aria-hidden="true">
        {String(place).padStart(2, '0')}
      </span>
      <CardLink
        {...link}
        className={styles.poster}
        tabIndex={-1}
        aria-hidden="true"
        onContextMenu={menu.onContextMenu}
      >
        <PosterFrame media={media} sizes={POSTER_SIZES.movieTile} withWatched={false} />
      </CardLink>
      <SelectCheckbox select={select} className={styles.select} />
      <span className={styles.body}>
        <CardLink
          {...link}
          className={styles.title}
          tabIndex={select.linkTabIndex}
          onContextMenu={menu.onContextMenu}
        >
          {title}
        </CardLink>
        {/* Words that wrap as text does, the heart and the score among them. */}
        <span className={styles.facts}>
          {media.favourite && (
            <span className={styles.heart}>
              <FavouriteMark media={media} />
            </span>
          )}
          <Dotted parts={filmFacts(media)} />
          {score && (
            <span className={styles.score}>
              <ScoreChip rating={score} />
            </span>
          )}
          <PartlyWatched media={media} />
        </span>
        <PlaybackNote media={media} />
      </span>
      {tag && <span className={`${styles.tag} ${tag.className}`}>{tag.label}</span>}
      <span className={styles.end}>
        {hasPage && !select.selecting && (
          <CardLink {...watchLink({ media })} className={styles.play} aria-label={`Play ${title}`}>
            <Icon name="play" size={14} />
          </CardLink>
        )}
        {menu.menu}
      </span>
    </li>
  )
}

/**
 * A saga's movies in release order, numbered, each on a row of its own with
 * the score its library goes by.
 */
export const SagaFilms = ({
  media,
  ratingsSource,
}: {
  media: readonly MediaItem[]
  ratingsSource: RatingSource
}) => {
  const standing = standings(media)
  return (
    <ol className={styles.films}>
      {media.map((each, index) => (
        <SagaFilm
          key={each.id}
          media={each}
          place={index + 1}
          standing={standing[index] ?? 'later'}
          ratingsSource={ratingsSource}
        />
      ))}
    </ol>
  )
}
