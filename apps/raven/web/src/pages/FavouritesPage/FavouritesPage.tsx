import { useQuery } from '@tanstack/react-query'
import { useId } from 'react'
import { PosterCard } from '@/components/PosterCard/PosterCard'
import { Loading, SkeletonCards } from '@/components/Skeleton/Skeleton'
import { POSTER_SIZES } from '@/lib/posters'
import { favouritesQuery } from '@/lib/queries'
import styles from '@/pages/FavouritesPage/FavouritesPage.module.scss'

const count = new Intl.NumberFormat()

/**
 * Every favourite across every library, most recently marked first, as
 * posters: a movie's own, an episode's season's.
 */
export const FavouritesPage = () => {
  const id = useId()
  const favourites = useQuery(favouritesQuery)
  const items = favourites.data ?? []

  return (
    <section className={styles.page} aria-labelledby={id}>
      <header className={styles.header}>
        <h1 id={id} className={styles.title}>
          Favourites
        </h1>
        {favourites.isSuccess && (
          <p className={styles.count}>
            {count.format(items.length)} {items.length === 1 ? 'video' : 'videos'}
          </p>
        )}
      </header>

      {favourites.isError && (
        <p className={styles.message} role="alert">
          {favourites.error.message}
        </p>
      )}
      {favourites.isPending && (
        <Loading label="Gathering your favourites">
          <ul className={styles.grid}>
            <SkeletonCards picture="poster" />
          </ul>
        </Loading>
      )}
      {favourites.isSuccess && items.length === 0 && (
        <p className={styles.message}>
          No favourites yet. Open a video's menu, from the button in its corner or a right click,
          and choose Favourite.
        </p>
      )}
      {items.length > 0 && (
        <ul className={styles.grid}>
          {items.map(({ media, poster }) => (
            <PosterCard key={media.id} media={media} poster={poster} sizes={POSTER_SIZES.grid} />
          ))}
        </ul>
      )}
    </section>
  )
}
