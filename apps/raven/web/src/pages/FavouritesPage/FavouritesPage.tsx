import { useQuery } from '@tanstack/react-query'
import { ITEM_TYPES, type ItemSummary, type MediaItem, type PosterEntry } from '@raven/core'
import { useId } from 'react'
import { useSearchParams } from 'react-router-dom'
import { BackButton, HOME } from '@/components/BackButton/BackButton'
import { PosterCard } from '@/components/PosterCard/PosterCard'
import { Loading, SkeletonCards } from '@/components/Skeleton/Skeleton'
import { TitleCard } from '@/components/TitleCard/TitleCard'
import { plural } from '@/lib/plural'
import { POSTER_SIZES } from '@/lib/posters'
import { favouriteTitlesQuery, favouritesQuery } from '@/lib/queries'
import styles from '@/pages/FavouritesPage/FavouritesPage.module.scss'

/** What a favourite can be, in the order the filter offers them. */
const KINDS = ['shows', 'seasons', 'movies', 'episodes', 'other'] as const

type Kind = (typeof KINDS)[number]

const KIND_LABELS = {
  shows: 'Shows',
  seasons: 'Seasons',
  movies: 'Movies',
  episodes: 'Episodes',
  other: 'Other videos',
} as const satisfies Record<Kind, string>

const isKind = (value: string | null): value is Kind => KINDS.some((kind) => kind === value)

/** A favourite title is a show or a season; anything else is a video's. */
const titleKindOf = (item: ItemSummary): Kind =>
  item.type === ITEM_TYPES.season ? 'seasons' : 'shows'

/** A favourite video is a movie's, an episode's, or one matched to neither. */
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

/** The kinds among `titles` and `entries`, in the filter's order. */
const kindsIn = ({
  titles,
  entries,
}: {
  titles: readonly ItemSummary[]
  entries: readonly PosterEntry[]
}): Kind[] =>
  KINDS.filter(
    (kind) =>
      titles.some((item) => titleKindOf(item) === kind) ||
      entries.some(({ media }) => kindOf(media) === kind),
  )

/**
 * Every favourite across every library but the locked ones, as posters:
 * the shows and seasons, then the videos, each most recently marked first;
 * a movie's own poster, an episode's season's. With more than one kind
 * among them, pills narrow them to one; the kind rides in the address as
 * `?kind=`, so coming back from a video lands on the same pills.
 */
export const FavouritesPage = () => {
  const id = useId()
  const videos = useQuery(favouritesQuery)
  const titleQuery = useQuery(favouriteTitlesQuery)
  const [searchParams, setSearchParams] = useSearchParams()
  const all = videos.data ?? []
  const allTitles = titleQuery.data ?? []
  const kinds = kindsIn({ titles: allTitles, entries: all })
  const asked = searchParams.get('kind')
  const kind = isKind(asked) && kinds.includes(asked) ? asked : null
  const items = kind ? all.filter(({ media }) => kindOf(media) === kind) : all
  const titles = kind ? allTitles.filter((item) => titleKindOf(item) === kind) : allTitles
  const error = videos.error ?? titleQuery.error
  const isPending = videos.isPending || titleQuery.isPending
  const isSuccess = videos.isSuccess && titleQuery.isSuccess
  const shown = titles.length + items.length

  return (
    <section className={styles.page} aria-labelledby={id}>
      <BackButton fallback={HOME} />
      <header className={styles.header}>
        <h1 id={id}>Favourites</h1>
        {isSuccess && (
          <p className={styles.count}>
            {plural({ n: shown, one: 'favourite', many: 'favourites' })}
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

      {error && (
        <p className={styles.message} role="alert">
          {error.message}
        </p>
      )}
      {isPending && !error && (
        <Loading label="Gathering your favourites">
          <ul className={styles.grid}>
            <SkeletonCards picture="poster" />
          </ul>
        </Loading>
      )}
      {isSuccess && all.length + allTitles.length === 0 && (
        <p className={styles.message}>
          No favourites yet. Press the heart on a movie, show or season page, or open a video's
          menu, from the button in its corner or a right click, and choose Favourite.
        </p>
      )}
      {shown > 0 && (
        <ul className={styles.grid}>
          {titles.map((item) => (
            <TitleCard key={`title-${item.id}`} item={item} />
          ))}
          {items.map(({ media, poster }) => (
            <PosterCard key={media.id} media={media} poster={poster} sizes={POSTER_SIZES.grid} />
          ))}
        </ul>
      )}
    </section>
  )
}
