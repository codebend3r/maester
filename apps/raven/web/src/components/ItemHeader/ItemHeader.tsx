import type { Rating } from '@raven/core'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '@/components/Icon/Icon'
import { RatingChips } from '@/components/RatingChips/RatingChips'
import type { watchLink } from '@/lib/itemLinks'
import styles from '@/components/ItemHeader/ItemHeader.module.scss'

/** The picture beside the title: a poster, or an episode's still, and the video it plays if it plays one. */
export type HeaderPicture = {
  shape: 'poster' | 'still'
  /** null for none yet: the title's first letter stands in. */
  url: string | null
  play?: ReturnType<typeof watchLink> & { label: string }
}

/** The content's columns for each kind of picture, or for none. */
const LAYOUTS = {
  poster: styles.content,
  still: `${styles.content} ${styles.withStill}`,
  none: `${styles.content} ${styles.noPicture}`,
} as const satisfies Record<HeaderPicture['shape'] | 'none', string | undefined>

const Picture = ({ picture, title }: { picture: HeaderPicture; title: string }) => {
  const className = picture.shape === 'still' ? `${styles.picture} ${styles.still}` : styles.picture
  const content = picture.url ? (
    <img src={picture.url} alt="" decoding="async" />
  ) : (
    <span aria-hidden="true">{title.slice(0, 1)}</span>
  )
  if (!picture.play) return <div className={className}>{content}</div>
  const { label, ...link } = picture.play
  return (
    <Link {...link} className={`${className} ${styles.playable}`} aria-label={label}>
      {content}
      <span className={styles.playMark} aria-hidden="true">
        <Icon name="play" size={28} />
      </span>
    </Link>
  )
}

/**
 * The top of a movie, show or episode page: the backdrop fading into the
 * page behind it, the picture (a poster, or an episode's still), the title
 * in display type with who made it beneath, the facts, the scores, and the
 * page's actions. A picture that plays its video shows a play mark on hover
 * and focus. On a narrow screen the picture sits above the rest.
 */
export const ItemHeader = ({
  titleId,
  title,
  byline,
  contentRating,
  facts,
  ratings,
  picture,
  backdrop,
  children,
}: {
  titleId: string
  title: string
  /** "Directed by ...", "Created by ...", or an episode's show and number. */
  byline: string | null
  contentRating: string | null
  facts: readonly string[]
  ratings: readonly Rating[]
  /** Left out for a page with no picture beside its title. */
  picture?: HeaderPicture
  backdrop: string | null
  /** The page's actions: Play, favourite, the menu. */
  children?: ReactNode
}) => (
  <header className={styles.hero}>
    {backdrop && <img className={styles.backdrop} src={backdrop} alt="" decoding="async" />}
    <div className={LAYOUTS[picture?.shape ?? 'none']}>
      {picture && <Picture picture={picture} title={title} />}
      <div className={styles.details}>
        <h1 id={titleId} className={styles.title}>
          {title}
        </h1>
        {byline && <p className={styles.byline}>{byline}</p>}
        {(contentRating != null || facts.length > 0) && (
          <p className={styles.facts}>
            {contentRating != null && (
              <span className={styles.badge}>
                <span className="visually-hidden">Rated </span>
                {contentRating}
              </span>
            )}
            {facts.map((fact) => (
              <span key={fact}>{fact}</span>
            ))}
          </p>
        )}
        <RatingChips ratings={[...ratings]} />
        {children && <div className={styles.actions}>{children}</div>}
      </div>
    </div>
  </header>
)
