import { type UpcomingShelf, requestKeyOf, uniqueUpcomingTitles } from '@raven/core'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useEffect, useId } from 'react'
import { BackButton } from '@/components/BackButton/BackButton'
import { PageTitle } from '@/components/PageTitle/PageTitle'
import { Loading, SkeletonCards } from '@/components/Skeleton/Skeleton'
import { TmdbCredit } from '@/components/TmdbCredit/TmdbCredit'
import { requestsQuery, upcomingShelfQuery } from '@/lib/queries'
import { useOnScreen } from '@/lib/useOnScreen'
import { COMING_SOON_COPY } from '@/pages/ComingSoonPage/copy'
import styles from '@/pages/ComingSoonPage/UpcomingShelfPage.module.scss'
import { UpcomingCard } from '@/pages/ComingSoonPage/UpcomingCard'
import { useHideRequested } from '@/pages/ComingSoonPage/useHideRequested'
import { APP_PATHS } from '@/lib/appPaths'
import { CARD_PICTURES } from '@/lib/cardPictures'

/** How far below the screen the end of the list is when the next page is asked for. */
const READ_AHEAD = '800px'

/** How many stand-ins hold the place of the first page. */
const FIRST_PAGE_STAND_INS = 16

const BACK_TO_COMING_SOON = { to: APP_PATHS.comingSoon, label: COMING_SOON_COPY.title } as const

type ShelfTitlesProps = {
  shelf: UpcomingShelf
  /** Whether the titles someone asked for, or a downloader holds, are left out. */
  isHidingRequested: boolean
}

/** The shelf's titles, the most popular first, reading the next page as the end of the list nears. */
const ShelfTitles = ({ shelf, isHidingRequested }: ShelfTitlesProps) => {
  const titles = useInfiniteQuery(upcomingShelfQuery(shelf))
  const { ref: endRef, isOnScreen: isEndInReach } = useOnScreen(READ_AHEAD)
  const { hasNextPage, isFetchingNextPage, isError, fetchNextPage } = titles
  // Asks again after each page while the end is still in reach, since a short page leaves it there.
  useEffect(() => {
    if (!isEndInReach || !hasNextPage || isFetchingNextPage || isError) return
    fetchNextPage().catch(() => undefined)
  }, [isEndInReach, hasNextPage, isFetchingNextPage, isError, fetchNextPage])
  // TMDB's order can shift between its pages and list a title twice; each shows once.
  const read = uniqueUpcomingTitles(titles.data?.pages.flatMap((page) => page.titles) ?? [])
  // Read for the filter alone; the cards read it for themselves.
  const { data: requests } = useQuery({ ...requestsQuery, enabled: isHidingRequested })
  const requested = new Set((requests?.requests ?? []).map(requestKeyOf))
  const shown = isHidingRequested
    ? read.filter((title) => !requested.has(requestKeyOf(title)))
    : read
  const isAllRequested = read.length > 0 && shown.length === 0 && !hasNextPage
  return (
    <>
      {titles.isError && (
        <p className={styles.message} role="alert">
          {titles.error.message}
        </p>
      )}
      {titles.isPending && (
        <Loading label={COMING_SOON_COPY.loading}>
          <ul className={styles.grid}>
            <SkeletonCards picture={CARD_PICTURES.poster} count={FIRST_PAGE_STAND_INS} />
          </ul>
        </Loading>
      )}
      {titles.isSuccess && read.length === 0 && !hasNextPage && (
        <p className={styles.message}>{COMING_SOON_COPY.empty}</p>
      )}
      {isAllRequested && <p className={styles.message}>{COMING_SOON_COPY.allRequested}</p>}
      {shown.length > 0 && (
        <ul className={styles.grid}>
          {shown.map((title) => (
            <UpcomingCard key={requestKeyOf(title)} title={title} shelf={shelf} />
          ))}
        </ul>
      )}
      {isFetchingNextPage && (
        <Loading label={COMING_SOON_COPY.loadingMore}>
          <ul className={styles.grid}>
            <SkeletonCards picture={CARD_PICTURES.poster} count={FIRST_PAGE_STAND_INS} />
          </ul>
        </Loading>
      )}
      <div ref={endRef} className={styles.end} aria-hidden="true" />
    </>
  )
}

type UpcomingShelfPageProps = { shelf: UpcomingShelf }

/**
 * `/coming-soon/<shelf>`: every title on one of Coming soon's shelves, the
 * most popular first, more read as the viewer scrolls; each card opens the
 * title's own page. A checkbox, off at first, leaves out what is requested
 * already: asked for by anyone, or held by a downloader. It stays as it was
 * left across the shelf pages, and the address says so while it is on.
 */
export const UpcomingShelfPage = ({ shelf }: UpcomingShelfPageProps) => {
  const titleId = useId()
  const [isHidingRequested, setHidingRequested] = useHideRequested()
  const copy = COMING_SOON_COPY.shelves[shelf]
  return (
    <section className={styles.page} aria-labelledby={titleId}>
      <header className={styles.header}>
        <BackButton fallback={BACK_TO_COMING_SOON} className={styles.back} />
        <PageTitle id={titleId} icon="calendar">
          {copy.title}
        </PageTitle>
        <p className={styles.intro}>{copy.intro}</p>
        <label className={styles.filter}>
          <input
            type="checkbox"
            checked={isHidingRequested}
            onChange={(event) => setHidingRequested(event.target.checked)}
          />
          {COMING_SOON_COPY.hideRequested}
        </label>
      </header>
      <ShelfTitles key={shelf} shelf={shelf} isHidingRequested={isHidingRequested} />
      <TmdbCredit />
    </section>
  )
}
