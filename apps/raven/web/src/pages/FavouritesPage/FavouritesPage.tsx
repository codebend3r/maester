import { useQuery } from '@tanstack/react-query'
import { useId } from 'react'
import { MediaGrid } from '@/components/MediaGrid/MediaGrid'
import { api } from '@/lib/api'
import { queryKeys } from '@/lib/queryClient'
import styles from './FavouritesPage.module.scss'

const count = new Intl.NumberFormat()

/** Every favourite across every library, most recently marked first. */
export const FavouritesPage = () => {
  const id = useId()
  const favourites = useQuery({ queryKey: queryKeys.favourites, queryFn: api.listFavourites })
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
      {favourites.isPending && <p className={styles.message}>Gathering your favourites</p>}
      {favourites.isSuccess && items.length === 0 && (
        <p className={styles.message}>
          No favourites yet. Open a video's menu, from the button in its corner or a right click,
          and choose Favourite.
        </p>
      )}
      {items.length > 0 && <MediaGrid items={items} />}
    </section>
  )
}
