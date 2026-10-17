import { useQuery } from '@tanstack/react-query'
import { ITEM_TYPES, type MediaItem, type PosterEntry } from '@raven/core'
import { useId } from 'react'
import { useSearchParams } from 'react-router-dom'
import { PosterCard } from '@/components/PosterCard/PosterCard'
import { Loading, SkeletonCards } from '@/components/Skeleton/Skeleton'
import { plural } from '@/lib/plural'
import { POSTER_SIZES } from '@/lib/posters'
import { favouritesQuery } from '@/lib/queries'
import styles from '@/pages/FavouritesPage/FavouritesPage.module.scss'

/** What a favourite can be, in the order the filter offers them. */
const KINDS = ['movies', 'episodes', 'other'] as const

type Kind = (typeof KINDS)[number]

const KIND_LABELS = {
  movies: 'Movies',
  episodes: 'Episodes',
  other: 'Other videos',
} as const satisfies Record<Kind, string>

const isKind = (value: string | null): value is Kind => KINDS.some((kind) => kind === value)

/** A favourite is a video: a movie's, an episode's, or one matched to neither. */
const kindOf = (media: MediaItem): Kind => {
  switch (media.item?.type) {
    case ITEM_TYPES.movie:
      return 'movies'
    case ITEM_TYPES.episode:
      return 'episodes'
    default:
      return 'other'
  }
}

/** The kinds among `entries`, in the filter's order. */
const kindsIn = (entries: readonly PosterEntry[]): Kind[] =>
  KINDS.filter((kind) => entries.some(({ media }) => kindOf(media) === kind))

/**
 * Every favourite across every library, most recently marked first, as
 * posters: a movie's own, an episode's season's. With more than one kind
 * among them, pills narrow them to one; the kind rides in the address as
 * `?kind=`, so coming back from a video lands on the same pills.
 */
export const FavouritesPage = () => {
  const id = useId()
  const favourites = useQuery(favouritesQuery)
  const [searchParams, setSearchParams] = useSearchParams()
  const all = favourites.data ?? []
  const kinds = kindsIn(all)
  const asked = searchParams.get('kind')
  const kind = isKind(asked) && kinds.includes(asked) ? asked : null
  const items = kind ? all.filter(({ media }) => kindOf(media) === kind) : all

  return (
    <section className={styles.page} aria-labelledby={id}>
      <header className={styles.header}>
        <h1 id={id}>Favourites</h1>
        {favourites.isSuccess && (
          <p className={styles.count}>
            {plural({ n: items.length, one: 'video', many: 'videos' })}
          </p>
        )}
      </header>

      {kinds.length > 1 && (
        <fieldset className={styles.kinds}>
          <legend className="visually-hidden">Show</legend>
          {[null, ...kinds].map((option) => (
            <button
              key={option ?? 'all'}
              type="button"
              className={styles.kind}
              aria-pressed={kind === option}
              onClick={() => setSearchParams(option ? { kind: option } : {}, { replace: true })}
            >
              {option ? KIND_LABELS[option] : 'All'}
            </button>
          ))}
        </fieldset>
      )}

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
      {favourites.isSuccess && all.length === 0 && (
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
