import {
  UPCOMING_SHELF_SIZES,
  UPCOMING_SHELVES,
  type TitleRequest,
  type TitleRequests,
  type Upcoming,
  type UpcomingShelf,
  type UpcomingTitle,
  addedRequestsOf,
  pendingRequestsOf,
} from '@raven/core'
import { useQuery } from '@tanstack/react-query'
import { type ComponentType, useId } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { BackButton, HOME } from '@/components/BackButton/BackButton'
import { PageTitle } from '@/components/PageTitle/PageTitle'
import { SectionHeading } from '@/components/SectionHeading/SectionHeading'
import { Loading, SkeletonCards } from '@/components/Skeleton/Skeleton'
import { Tabs } from '@/components/Tabs/Tabs'
import { TmdbCredit } from '@/components/TmdbCredit/TmdbCredit'
import { useCanManage } from '@/lib/management'
import { everyonesRequestsQuery, requestsQuery, upcomingQuery } from '@/lib/queries'
import styles from '@/pages/ComingSoonPage/ComingSoonPage.module.scss'
import { COMING_SOON_COPY } from '@/pages/ComingSoonPage/copy'
import { UpcomingCard } from '@/pages/ComingSoonPage/UpcomingCard'
import { APP_PATHS, comingSoonShelfPath } from '@/lib/appPaths'
import { CARD_PICTURES } from '@/lib/cardPictures'
import { handled } from '@/lib/handled'
import { COMING_SOON_TABS, type ComingSoonTab } from '@/pages/ComingSoonPage/comingSoonTabs'
import { EveryonesRequests } from '@/pages/ComingSoonPage/EveryonesRequests'
import { AddedRequests, PendingRequests } from '@/pages/ComingSoonPage/RequestsGrid'

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
  { name: UPCOMING_SHELVES.anime, rows: SHELF_ROWS.one },
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

type ShelfOfProps = { upcoming: Upcoming | undefined; plan: ShelfPlan }

/** A shelf's titles once the shelves are read; an older server sends no anime, which reads as none announced. */
const shelfOf = ({ upcoming, plan }: ShelfOfProps): readonly UpcomingTitle[] | undefined =>
  upcoming === undefined ? undefined : (upcoming[plan.name] ?? [])

/**
 * The Upcoming tab: what TMDB says is on its way, the most popular first.
 * Two rows of movies, two of TV shows, then one row of documentaries and one
 * of anime, each of both kinds, each card a poster as a library shows them.
 */
const UpcomingShelves = () => {
  const upcoming = useQuery(upcomingQuery)
  return (
    <div className={styles.panel}>
      {upcoming.isError && (
        <p className={styles.message} role="alert">
          {upcoming.error.message}
        </p>
      )}
      {!upcoming.isError &&
        SHELVES.map((plan) => (
          <Shelf key={plan.name} plan={plan} titles={shelfOf({ upcoming: upcoming.data, plan })} />
        ))}
    </div>
  )
}

const NotManaging = () => <p className={styles.message}>{COMING_SOON_COPY.everyone.managersOnly}</p>

const MANAGE_STATES = { managing: 'managing', refused: 'refused' } as const

type ManageState = (typeof MANAGE_STATES)[keyof typeof MANAGE_STATES]

const EVERYONE_VIEWS = {
  [MANAGE_STATES.managing]: EveryonesRequests,
  [MANAGE_STATES.refused]: NotManaging,
} as const satisfies Record<ManageState, ComponentType>

/** The All requests tab to whoever manages raven; anyone else who opens its address is told whose it is, and the server is asked nothing. */
const EveryonesPanel = () => {
  const View = EVERYONE_VIEWS[useCanManage() ? MANAGE_STATES.managing : MANAGE_STATES.refused]
  return <View />
}

const TAB_PANELS = {
  [COMING_SOON_TABS.upcoming]: UpcomingShelves,
  [COMING_SOON_TABS.pending]: PendingRequests,
  [COMING_SOON_TABS.added]: AddedRequests,
  [COMING_SOON_TABS.everyone]: EveryonesPanel,
} as const satisfies Record<ComingSoonTab, ComponentType>

/** Where each tab lives, so a tab is a link that survives a reload. */
const TAB_PATHS = {
  [COMING_SOON_TABS.upcoming]: APP_PATHS.comingSoon,
  [COMING_SOON_TABS.pending]: APP_PATHS.comingSoonPending,
  [COMING_SOON_TABS.added]: APP_PATHS.comingSoonAdded,
  [COMING_SOON_TABS.everyone]: APP_PATHS.comingSoonEveryone,
} as const satisfies Record<ComingSoonTab, string>

type ComingSoonPageProps = { tab: ComingSoonTab }

/** Picks the caller's requests one tab holds, to count them. */
type RequestPick = (list: TitleRequests) => readonly TitleRequest[]

/**
 * `/coming-soon`, `/coming-soon/pending` and `/coming-soon/added`: three
 * tabs, each its own route. Upcoming is what TMDB says is on its way;
 * Pending is the caller's requests, and the titles the downloaders hold
 * already, that are still on their way, with how many requests are left
 * today; Added is those a library holds now or that have downloaded.
 * Whoever manages raven has a fourth, All requests: every account's
 * requests and whose each was.
 */
export const ComingSoonPage = ({ tab }: ComingSoonPageProps) => {
  const titleId = useId()
  const navigate = useNavigate()
  const { data: requests } = useQuery(requestsQuery)
  const countOf = (pick: RequestPick) =>
    requests === undefined ? {} : { count: pick(requests).length }
  // Only whoever manages raven sees the tab of every account's requests, or is asked for them.
  const canManage = useCanManage()
  const { data: everyones } = useQuery({ ...everyonesRequestsQuery, enabled: canManage })
  const everyoneTab = {
    value: COMING_SOON_TABS.everyone,
    label: COMING_SOON_COPY.tabs.everyone,
    ...(everyones === undefined ? {} : { count: everyones.length }),
  }
  const Panel = TAB_PANELS[tab]
  return (
    <section className={styles.page} aria-labelledby={titleId}>
      <header className={styles.header}>
        <BackButton fallback={HOME} className={styles.back} />
        <PageTitle id={titleId} icon="calendar">
          {COMING_SOON_COPY.title}
        </PageTitle>
        <p className={styles.intro}>{COMING_SOON_COPY.intro}</p>
      </header>
      <Tabs
        label={COMING_SOON_COPY.tabs.label}
        tabs={[
          { value: COMING_SOON_TABS.upcoming, label: COMING_SOON_COPY.tabs.upcoming },
          {
            value: COMING_SOON_TABS.pending,
            label: COMING_SOON_COPY.tabs.pending,
            ...countOf(pendingRequestsOf),
          },
          {
            value: COMING_SOON_TABS.added,
            label: COMING_SOON_COPY.tabs.added,
            ...countOf(addedRequestsOf),
          },
          ...(canManage || tab === COMING_SOON_TABS.everyone ? [everyoneTab] : []),
        ]}
        chosen={tab}
        onChoose={(next) => handled(Promise.resolve(navigate(TAB_PATHS[next])))}
      >
        <Panel />
      </Tabs>
      <TmdbCredit />
    </section>
  )
}
