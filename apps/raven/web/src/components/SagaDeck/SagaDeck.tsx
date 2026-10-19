import { type Saga, sagaCover, sagaEntryKey, sagaFacts, sagaPath } from '@raven/core'
import { Link } from 'react-router-dom'
import { PosterImage } from '@/components/PosterImage/PosterImage'
import { SelectCheckbox } from '@/components/SelectCheckbox/SelectCheckbox'
import { WatchedCount } from '@/components/WatchedCount/WatchedCount'
import { api } from '@/lib/api'
import { POSTER_SIZES } from '@/lib/posters'
import { useHoverBackdrop } from '@/lib/useHoverBackdrop'
import { useSelectable } from '@/lib/useSelectable'
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
  const select = useSelectable({ key: sagaEntryKey(saga), title: saga.name })
  return (
    <li className={styles.item} data-entry={sagaEntryKey(saga)} {...hover} {...select.rootProps}>
      <SelectCheckbox select={select} className={styles.select} />
      <Link to={to} className={styles.card} tabIndex={select.linkTabIndex}>
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
        <span className={styles.facts}>
          <span>{sagaFacts(saga).join(' · ')}</span>
          <WatchedCount
            watched={saga.media.filter((media) => media.watched).length}
            total={saga.media.length}
            unit="movie"
          />
        </span>
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
