import { type Saga, sagaCover } from '@raven/core'
import { Link } from 'react-router-dom'
import { PosterImage } from '@/components/PosterImage/PosterImage'
import { api } from '@/lib/api'
import { POSTER_SIZES } from '@/lib/posters'
import { sagaFacts, sagaPath } from '@/lib/sagas'
import { useHoverBackdrop } from '@/lib/useHoverBackdrop'
import styles from '@/components/SagaDeck/SagaDeck.module.scss'

/**
 * A saga as a deck of its posters, the first movie on top. Pointed at or
 * focused, the deck fans out like a hand of cards, and the saga's cover
 * comes in behind the page; it opens the saga's page.
 * Each poster's place in the deck, and the deck's size, ride in custom
 * properties the fan is worked out from.
 */
const SagaDeck = ({ saga, to }: { saga: Saga; to: string }) => {
  const cover = sagaCover(saga)
  const hover = useHoverBackdrop(cover && api.sagaPictureUrl(cover))
  return (
    <li className={styles.item} {...hover}>
      <Link to={to} className={styles.card}>
        <span
          className={styles.deck}
          aria-hidden="true"
          ref={(node) => node?.style.setProperty('--count', String(saga.media.length))}
        >
          {saga.media.map((media, index) => (
            <span
              key={media.id}
              className={styles.poster}
              ref={(node) => node?.style.setProperty('--index', String(index))}
            >
              <PosterImage media={media} sizes={POSTER_SIZES.deck} />
            </span>
          ))}
        </span>
        <span className={styles.name}>{saga.name}</span>
        <span className={styles.facts}>{sagaFacts(saga).join(' · ')}</span>
      </Link>
    </li>
  )
}

/** A library's sagas side by side, each a deck. */
export const SagaDecks = ({ libraryId, sagas }: { libraryId: number; sagas: readonly Saga[] }) => (
  <ul className={styles.decks}>
    {sagas.map((saga) => (
      <SagaDeck key={saga.tmdbId} saga={saga} to={sagaPath({ libraryId, saga })} />
    ))}
  </ul>
)
