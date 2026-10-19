import { useQuery } from '@tanstack/react-query'
import { Icon } from '@raven/ui'
import { Link } from 'react-router-dom'
import { PosterImage } from '@/components/PosterImage/PosterImage'
import { POSTER_SIZES } from '@/lib/posters'
import { sagasQuery } from '@/lib/queries'
import { sagaPath } from '@/lib/sagas'
import styles from '@/components/SagaLink/SagaLink.module.scss'

/** The most posters the card fans; a longer saga shows its first few. */
const FANNED = 3

/**
 * A movie's way to its saga: a card under the header with a fan of the
 * saga's posters, the movie's place in it and the saga's name, opening the
 * saga's page. Nothing while the library's sagas load, or when the movie is
 * in none (a saga holds two movies or more).
 */
export const SagaLink = ({ itemId, libraryId }: { itemId: number; libraryId: number }) => {
  const sagas = useQuery(sagasQuery(libraryId))
  const saga = sagas.data?.find((entry) => entry.media.some((media) => media.item?.id === itemId))
  if (!saga) return null
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
          Part {part} of {saga.media.length} in the saga
        </span>
        <span className={styles.name}>{saga.name}</span>
      </span>
      <span className={styles.go}>
        View saga
        <Icon name="next" size={16} />
      </span>
    </Link>
  )
}
