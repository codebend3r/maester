import type { Rating } from '@raven/core'
import type { ReactNode } from 'react'
import { RatingChips } from '@/components/RatingChips/RatingChips'
import styles from '@/components/ItemHeader/ItemHeader.module.scss'

/**
 * The top of a movie, show or episode page: the backdrop fading into the
 * page behind it, the poster, the title in display type with who made it
 * beneath, the facts, the scores, and the page's actions. On a narrow
 * screen the poster sits above the rest.
 */
export const ItemHeader = ({
  titleId,
  title,
  byline,
  contentRating,
  facts,
  ratings,
  poster,
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
  poster: string | null
  backdrop: string | null
  /** The page's actions: Play, favourite, the menu. */
  children?: ReactNode
}) => (
  <header className={styles.hero}>
    {backdrop && <img className={styles.backdrop} src={backdrop} alt="" decoding="async" />}
    <div className={styles.content}>
      <div className={styles.poster}>
        {poster ? (
          <img src={poster} alt="" decoding="async" />
        ) : (
          <span aria-hidden="true">{title.slice(0, 1)}</span>
        )}
      </div>
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
