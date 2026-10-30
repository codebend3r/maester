import { useQuery } from '@tanstack/react-query'
import { type Saga, sagaPath } from '@raven/core'
import { Icon } from '@raven/ui'
import { Link } from 'react-router-dom'
import { PosterImage } from '@/components/PosterImage/PosterImage'
import { SAGA_LINK_COPY } from '@/components/SagaLink/copy'
import { POSTER_SIZES } from '@/lib/posters'
import { sagasQuery } from '@/lib/queries'
import styles from '@/components/SagaLink/SagaLink.module.scss'

/** The most posters the card fans; a longer saga shows its first few. */
const FANNED = 3

type SagaCardProps = { itemId: number; libraryId: number; saga: Saga }

const SagaCard = ({ itemId, libraryId, saga }: SagaCardProps) => {
  const part = saga.media.findIndex((media) => media.item?.id === itemId) + 1
  return (
    <Link to={sagaPath({ libraryId, saga })} className={styles.card}>
      <span className={styles.fan} aria-hidden="true">
        {saga.media.slice(0, FANNED).map((media) => (
          <span key={media.id} className={styles.poster}>
            <PosterImage media={media} sizes={POSTER_SIZES.list} />
          </span>
        ))}
      </span>
      <span className={styles.words}>
        <span className={styles.place}>
          {SAGA_LINK_COPY.part({ part, total: saga.media.length })}
        </span>
        <span className={styles.name}>{saga.name}</span>
      </span>
      <span className={styles.go}>
        {SAGA_LINK_COPY.viewSaga}
        <Icon name="next" size={16} />
      </span>
    </Link>
  )
}

type SagaLinkProps = { itemId: number; libraryId: number }

/**
 * A movie's way to its saga: a card under the header with a fan of the
 * saga's posters, the movie's place in it and the saga's name, opening the
 * saga's page. Nothing while the library's sagas load, or when the movie is
 * in none (a saga holds two movies or more).
 */
export const SagaLink = ({ itemId, libraryId }: SagaLinkProps) => {
  const sagas = useQuery(sagasQuery(libraryId))
  const saga = sagas.data?.find((entry) => entry.media.some((media) => media.item?.id === itemId))
  return saga !== undefined && <SagaCard itemId={itemId} libraryId={libraryId} saga={saga} />
}
