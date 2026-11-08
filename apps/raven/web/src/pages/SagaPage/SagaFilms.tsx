import {
  type MediaItem,
  SESSION_KINDS,
  type ViewingSession,
  cardLink,
  cardTitle,
  formatRuntime,
  mediaEntryKey,
  pictureParts,
  watchLink,
} from '@raven/core'
import { Icon, PictureChips } from '@raven/ui'
import type { ReactNode } from 'react'
import { CardLink } from '@/components/CardLink/CardLink'
import { FavouriteMark } from '@/components/FavouriteMark/FavouriteMark'
import { Dotted } from '@/components/ItemHeader/ItemHeader'
import { useCardMenu } from '@/components/MediaMenu/useCardMenu'
import { PlaybackNote } from '@/components/PlaybackNote/PlaybackNote'
import { PosterFrame } from '@/components/PosterCard/PosterCard'
import { PANEL_SIZES, RatingPanel } from '@/components/RatingPanel/RatingPanel'
import { PartlyWatched } from '@/components/ResumeBar/ResumeBar'
import { SelectCheckbox } from '@/components/SelectCheckbox/SelectCheckbox'
import { POSTER_SIZES } from '@/lib/posters'
import { useSelectable } from '@/lib/useSelectable'
import { SAGA_COPY } from '@/pages/SagaPage/copy'
import styles from '@/pages/SagaPage/SagaFilms.module.scss'
import { COMMON_COPY } from '@/lib/copy'

/** Where a movie stands in the saga: watched, the one to watch next, or neither. */
const STANDINGS = { watched: 'watched', next: 'next', later: 'later' } as const

type Standing = (typeof STANDINGS)[keyof typeof STANDINGS]

const TAGS = {
  [STANDINGS.watched]: { label: COMMON_COPY.watched, className: styles.watchedTag },
  [STANDINGS.next]: { label: SAGA_COPY.upNext, className: styles.nextTag },
  [STANDINGS.later]: null,
} as const satisfies Record<Standing, { label: string; className: string | undefined } | null>

/** Each movie's standing: the watched ones, then the first not watched is up next. */
const standings = (media: readonly MediaItem[]): Standing[] => {
  const next = media.findIndex((each) => !each.watched)
  return media.map((each, index) => {
    if (each.watched) return STANDINGS.watched
    return index === next ? STANDINGS.next : STANDINGS.later
  })
}

/** "22 May 2001 · 2h 58m · 4K HDR HEVC": when it came out, how long it runs, and its picture. */
const filmFacts = (media: MediaItem): ReactNode[] => {
  const { date } = cardTitle(media)
  return [
    date,
    formatRuntime(media.duration),
    pictureParts(media).length > 0 ? <PictureChips key="picture" media={media} /> : null,
    media.versions > 1 ? SAGA_COPY.versions(media.versions) : null,
  ].filter((fact) => fact != null)
}

type SagaFilmProps = {
  media: MediaItem
  session: ViewingSession
  place: number
  standing: Standing
}

/**
 * One movie of the saga on a row: its place in the order in large serif
 * figures (dim once watched), its poster, title and facts, every score it
 * has in a small panel, whether it is watched or up next, and a round button
 * that plays it and then the saga's movies after it, in `session`. The title
 * opens its page; a right click opens its menu; in select mode a click
 * anywhere on the row selects it.
 */
const SagaFilm = ({ media, session, place, standing }: SagaFilmProps) => {
  const menu = useCardMenu({ media, matchType: 'movie', inline: true })
  const { title } = cardTitle(media)
  const select = useSelectable({ key: mediaEntryKey(media), title })
  const link = cardLink({ media, hasPages: true })
  const hasPage = link.state == null
  const tag = TAGS[standing]
  return (
    <li
      className={[styles.film, menu.hostClass, standing === STANDINGS.watched ? styles.seen : '']
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
        <PosterFrame media={media} sizes={POSTER_SIZES.sagaFilm} withWatched={false} />
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
        {/* Words that wrap as text does, the heart among them. */}
        <span className={styles.facts}>
          {media.favourite && (
            <span className={styles.heart}>
              <FavouriteMark media={media} />
            </span>
          )}
          <Dotted parts={filmFacts(media)} />
          <PartlyWatched media={media} />
        </span>
        {media.item && <RatingPanel ratings={media.item.ratings} size={PANEL_SIZES.mini} />}
        <PlaybackNote media={media} />
      </span>
      {tag && <span className={`${styles.tag} ${tag.className}`}>{tag.label}</span>}
      <span className={styles.end}>
        {hasPage && !select.selecting && (
          <CardLink
            {...watchLink({ media, session })}
            className={styles.play}
            aria-label={SAGA_COPY.play(title)}
          >
            <Icon name="play" size={14} />
          </CardLink>
        )}
        {menu.menu}
      </span>
    </li>
  )
}

type SagaFilmsProps = {
  media: readonly MediaItem[]
  /** The saga's TMDB collection id, the session its films play in. */
  sagaId: string
}

/**
 * A saga's movies in release order, numbered, each on a row of its own with
 * every score it has.
 */
export const SagaFilms = ({ media, sagaId }: SagaFilmsProps) => {
  const standing = standings(media)
  const session = { kind: SESSION_KINDS.saga, sagaId }
  return (
    <ol className={styles.films}>
      {media.map((each, index) => (
        <SagaFilm
          key={each.id}
          media={each}
          session={session}
          place={index + 1}
          standing={standing[index] ?? STANDINGS.later}
        />
      ))}
    </ol>
  )
}
