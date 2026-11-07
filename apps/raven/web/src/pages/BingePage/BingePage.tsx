import { useQueries } from '@tanstack/react-query'
import { useId } from 'react'
import { ITEM_TYPES, type ItemDetails } from '@raven/core'
import { Button, ButtonLink, Icon } from '@raven/ui'
import { BackButton, HOME } from '@/components/BackButton/BackButton'
import { PageTitle } from '@/components/PageTitle/PageTitle'
import { BingeCard, BingeCardSkeleton } from '@/components/BingeCard/BingeCard'
import { Loading } from '@/components/Skeleton/Skeleton'
import { BINGE_BROWSE_PATH, BINGE_COPY } from '@/lib/binge'
import { bingeQuery } from '@/lib/bingeQuery'
import { useBingeProfile, useSetBinge } from '@/lib/useBinge'
import styles from '@/pages/BingePage/BingePage.module.scss'

/** How many cards stand in on the Binge page before the list says how many it holds. */
const UNKNOWN_SKELETON_COUNT = 2

type BingeSkeletonProps = { count: number }

/** The cards on their way, laid out as the grid lays the real ones. */
const BingeSkeleton = ({ count }: BingeSkeletonProps) => (
  <Loading label={BINGE_COPY.loading}>
    <ul className={styles.grid}>
      {Array.from({ length: count }, (_, index) => (
        <BingeCardSkeleton key={index} />
      ))}
    </ul>
  </Loading>
)

/** The binge list read: its shows, whether any is still on its way, and those that could not be read. */
const useBingeShows = () => {
  const { ids, isPending: isListPending } = useBingeProfile()
  const queries = useQueries({ queries: ids.map((id) => bingeQuery(id)) })
  const shows = queries.flatMap((query) =>
    query.isSuccess && query.data !== null && query.data.type === ITEM_TYPES.show
      ? [query.data]
      : [],
  )
  const failures = queries.flatMap((query, index) => {
    const id = ids[index]
    return id !== undefined &&
      (query.isError ||
        (query.isSuccess && (query.data === null || query.data.type !== ITEM_TYPES.show)))
      ? [{ id, query }]
      : []
  })
  return {
    ids,
    isListPending,
    isPending: queries.some((query) => query.isPending),
    shows,
    failures,
  }
}

type BingeGridProps = {
  shows: readonly ItemDetails[]
  /** How many cards stand in while no show has arrived; none draws nothing then. */
  skeletons: number
}

/** The shows as cards, the first across the grid; until one arrives, cards of their shape. */
const BingeGrid = ({ shows, skeletons }: BingeGridProps) => (
  <>
    {shows.length === 0 && skeletons > 0 && <BingeSkeleton count={skeletons} />}
    {shows.length > 0 && (
      <ul className={styles.grid}>
        {shows.map((item) => (
          <BingeCard key={item.id} details={item} />
        ))}
      </ul>
    )}
  </>
)

/**
 * Home's Binge section, first on the page and right under its title: drawn once the list says
 * it holds shows, with cards of their shape until they arrive, and nothing for a list that is
 * empty. It shows no heading, so the cards start as high as they can; its name is for screen readers.
 */
export const HomeBinge = () => {
  const { ids, isPending, shows } = useBingeShows()
  return (
    (shows.length > 0 || isPending) && (
      <section className={styles.section} aria-label={BINGE_COPY.title}>
        <BingeGrid shows={shows} skeletons={isPending ? ids.length : 0} />
      </section>
    )
  )
}

type PageSkeletonCountProps = { isListPending: boolean; isPending: boolean; count: number }

/** How many cards stand in on the page: a guess before the list is read, then one per show on its way. */
const pageSkeletonCountOf = ({ isListPending, isPending, count }: PageSkeletonCountProps) => {
  if (isListPending) return UNKNOWN_SKELETON_COUNT
  return isPending ? count : 0
}

/** The Binge page's list: the way to find shows while it is empty, each show that failed, then the cards. */
const BingeList = () => {
  const { ids, isListPending, isPending, shows, failures } = useBingeShows()
  const setBinge = useSetBinge()
  return (
    <section className={styles.section}>
      {!isListPending && ids.length === 0 && (
        <section className={styles.empty}>
          <Icon name="playback" size={40} />
          <h2>{BINGE_COPY.emptyTitle}</h2>
          <p>{BINGE_COPY.emptyBody}</p>
          <p>{BINGE_COPY.emptyHelp}</p>
          <ButtonLink to={BINGE_BROWSE_PATH} icon="libraries">
            {BINGE_COPY.browse}
          </ButtonLink>
        </section>
      )}
      {failures.map(({ id, query }) => (
        <section key={id} className={styles.failure}>
          <p role="alert">{BINGE_COPY.unavailable}</p>
          <Button
            onClick={() => {
              query.refetch().catch(() => undefined)
            }}
          >
            {BINGE_COPY.retry}
          </Button>
          <Button onClick={() => setBinge.mutate({ id, binge: false })}>{BINGE_COPY.remove}</Button>
        </section>
      ))}
      <BingeGrid
        shows={shows}
        skeletons={pageSkeletonCountOf({ isListPending, isPending, count: ids.length })}
      />
    </section>
  )
}

export const BingePage = () => {
  const titleId = useId()
  return (
    <section className={styles.page} aria-labelledby={titleId}>
      <BackButton fallback={HOME} />
      <PageTitle id={titleId} icon="popcorn">
        {BINGE_COPY.title}
      </PageTitle>
      <BingeList />
    </section>
  )
}
