import {
  UPCOMING_SHELF_SIZES,
  UPCOMING_SHELVES,
  type UpcomingShelf,
  type UpcomingTitle,
} from '@raven/core'
import { useQuery } from '@tanstack/react-query'
import { useId } from 'react'
import { Link } from 'react-router-dom'
import { BackButton, HOME } from '@/components/BackButton/BackButton'
import { PageTitle } from '@/components/PageTitle/PageTitle'
import { SectionHeading } from '@/components/SectionHeading/SectionHeading'
import { Loading, SkeletonCards } from '@/components/Skeleton/Skeleton'
import { TmdbCredit } from '@/components/TmdbCredit/TmdbCredit'
import { upcomingQuery } from '@/lib/queries'
import styles from '@/pages/ComingSoonPage/ComingSoonPage.module.scss'
import { COMING_SOON_COPY } from '@/pages/ComingSoonPage/copy'
import { UpcomingCard } from '@/pages/ComingSoonPage/UpcomingCard'
import { comingSoonShelfPath } from '@/lib/appPaths'
import { CARD_PICTURES } from '@/lib/cardPictures'

/** How many rows of posters a shelf holds, however many fit across. */
const SHELF_ROWS = { one: 'one', two: 'two' } as const

type ShelfRows = (typeof SHELF_ROWS)[keyof typeof SHELF_ROWS]

const ROW_CLASSES = {
  [SHELF_ROWS.one]: styles.oneRow,
  [SHELF_ROWS.two]: styles.twoRows,
} as const satisfies Record<ShelfRows, string | undefined>

type ShelfPlan = {
  /** Which of the server's shelves it shows, and whose own page its heading opens. */
  name: UpcomingShelf
  rows: ShelfRows
}

/** The page's shelves, top to bottom. */
const SHELVES = [
  { name: UPCOMING_SHELVES.movies, rows: SHELF_ROWS.two },
  { name: UPCOMING_SHELVES.shows, rows: SHELF_ROWS.two },
  { name: UPCOMING_SHELVES.documentaries, rows: SHELF_ROWS.one },
] as const satisfies readonly ShelfPlan[]

type ShelfProps = {
  plan: ShelfPlan
  /** The shelf's titles; none while they are read. */
  titles: readonly UpcomingTitle[] | undefined
}

/*
 * One shelf under its ruled heading, which opens the shelf's own page: its
 * posters in as many rows as `rows` says, cut off at the last whole row at
 * any width, stand-ins while it is read, or a line saying nothing is announced.
 */
const Shelf = ({ plan, titles }: ShelfProps) => {
  const { name, rows } = plan
  const headingId = useId()
  const shelfClass = `${styles.shelf} ${ROW_CLASSES[rows]}`
  return (
    <section className={styles.section} aria-labelledby={headingId}>
      <SectionHeading id={headingId}>
        <Link to={comingSoonShelfPath(name)} className={styles.shelfLink}>
          {COMING_SOON_COPY.shelves[name].title}
        </Link>
      </SectionHeading>
      {titles === undefined && (
        <Loading label={COMING_SOON_COPY.loading}>
          <ul className={shelfClass}>
            <SkeletonCards picture={CARD_PICTURES.poster} count={UPCOMING_SHELF_SIZES[name]} />
          </ul>
        </Loading>
      )}
      {(titles?.length ?? null) === 0 && <p className={styles.message}>{COMING_SOON_COPY.empty}</p>}
      {!!titles?.length && (
        <ul className={shelfClass}>
          {titles.map((title) => (
            <UpcomingCard key={`${title.type}-${title.tmdbId}`} title={title} shelf={name} />
          ))}
        </ul>
      )}
    </section>
  )
}

/**
 * `/coming-soon`: what TMDB says is on its way, the most popular first. Two
 * rows of movies, two of TV shows, then one row of documentaries of both
 * kinds, each card a poster as a library shows them.
 */
export const ComingSoonPage = () => {
  const titleId = useId()
  const upcoming = useQuery(upcomingQuery)
  return (
    <section className={styles.page} aria-labelledby={titleId}>
      <header className={styles.header}>
        <BackButton fallback={HOME} className={styles.back} />
        <PageTitle id={titleId} icon="calendar">
          {COMING_SOON_COPY.title}
        </PageTitle>
        <p className={styles.intro}>{COMING_SOON_COPY.intro}</p>
      </header>
      {upcoming.isError && (
        <p className={styles.message} role="alert">
          {upcoming.error.message}
        </p>
      )}
      {!upcoming.isError &&
        SHELVES.map((plan) => (
          <Shelf key={plan.name} plan={plan} titles={upcoming.data?.[plan.name]} />
        ))}
      <TmdbCredit />
    </section>
  )
}
