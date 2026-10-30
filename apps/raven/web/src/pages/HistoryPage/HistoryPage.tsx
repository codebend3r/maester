import { useQuery } from '@tanstack/react-query'
import {
  type HistoryEntry,
  type Library,
  ROUTE_STATES,
  type RouteQuery,
  historyDays,
  historyNote,
  routeState,
} from '@raven/core'
import { useId, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Button } from '@raven/ui'
import { BackButton } from '@/components/BackButton/BackButton'
import { MediaTiles, MediaTilesSkeleton } from '@/components/MediaTiles/MediaTiles'
import { RouteState } from '@/components/RouteState/RouteState'
import { Bone, Loading } from '@/components/Skeleton/Skeleton'
import {
  HISTORY_SHOWS,
  type HistoryShow,
  KeyedView,
  type ViewOf,
  type ViewsOf,
} from '@raven/ui/headless'
import { historyQuery, libraryQuery } from '@/lib/queries'
import { useRouteId } from '@/lib/routeQuery'
import { HISTORY_COPY } from '@/pages/HistoryPage/copy'
import styles from '@/pages/HistoryPage/HistoryPage.module.scss'
import { COMMON_COPY } from '@/lib/copy'

/** How many entries a page of history adds. */
const PAGE = 100

/** The address's search params this page reads. */
const SEARCH_PARAMS = { show: 'show' } as const

const SHOWS: ReadonlyArray<{ show: HistoryShow; label: string }> = [
  { show: HISTORY_SHOWS.watched, label: COMMON_COPY.watched },
  { show: HISTORY_SHOWS.all, label: HISTORY_COPY.allPlayed },
]

type HistoryDaySectionProps = {
  id: string
  label: string
  entries: HistoryEntry[]
}

/** One day's videos under its heading, each with how far it got and when. */
const HistoryDaySection = ({ id, label, entries }: HistoryDaySectionProps) => {
  const notes = new Map(entries.map((entry) => [entry.media.id, historyNote(entry)]))
  return (
    <section className={styles.day} aria-labelledby={id}>
      <h2 id={id} className={styles.heading}>
        {label}
      </h2>
      <MediaTiles
        items={entries.map((entry) => entry.media)}
        note={(media) => notes.get(media.id) ?? null}
        withWatched={false}
      />
    </section>
  )
}

/** The history on its way, before its library is known: the way back, its title and intro, its switch, over tiles. */
const HistorySkeleton = () => (
  <>
    <Bone shape="button" />
    <Bone shape="hero" width="half" />
    <Bone shape="text" width="most" />
    <Bone shape="button" />
    <MediaTilesSkeleton />
  </>
)

type HistoryViewProps = { library: Library }

/** The history once its library is known: its switch, then the days, more on request. */
const HistoryView = ({ library }: HistoryViewProps) => {
  const ids = { title: useId() }
  const [searchParams, setSearchParams] = useSearchParams()
  const show: HistoryShow =
    searchParams.get(SEARCH_PARAMS.show) === HISTORY_SHOWS.all
      ? HISTORY_SHOWS.all
      : HISTORY_SHOWS.watched
  const [limit, setLimit] = useState(PAGE)
  const { id, name, settings } = library
  const history = useQuery(historyQuery({ libraryId: id, show, limit }))
  const entries = history.data ?? []

  return (
    <section className={styles.page} aria-labelledby={ids.title}>
      <BackButton fallback={{ to: `/libraries/${id}`, label: name }} />

      <header className={styles.header}>
        <h1 id={ids.title}>{COMMON_COPY.history}</h1>
        <p className={styles.intro}>
          {HISTORY_COPY.intro({ name, watchedPercent: settings.watchedPercent })}
        </p>
      </header>

      <fieldset className={styles.shows}>
        <legend className="visually-hidden">{HISTORY_COPY.show}</legend>
        {SHOWS.map((option) => (
          <button
            key={option.show}
            type="button"
            className={styles.show}
            aria-pressed={show === option.show}
            onClick={() => {
              setLimit(PAGE)
              setSearchParams(
                option.show === HISTORY_SHOWS.all
                  ? { [SEARCH_PARAMS.show]: HISTORY_SHOWS.all }
                  : {},
                { replace: true },
              )
            }}
          >
            {option.label}
          </button>
        ))}
      </fieldset>

      {history.isError && (
        <p className={styles.message} role="alert">
          {history.error.message}
        </p>
      )}
      {history.isPending && (
        <Loading label={HISTORY_COPY.loading}>
          <MediaTilesSkeleton />
        </Loading>
      )}
      {history.isSuccess && entries.length === 0 && (
        <p className={styles.message}>
          {show === HISTORY_SHOWS.watched
            ? HISTORY_COPY.nothingWatched(name)
            : HISTORY_COPY.nothingPlayed(name)}
        </p>
      )}

      {entries.length > 0 && (
        <div className={styles.days} aria-busy={history.isFetching}>
          {historyDays({ entries }).map((day) => (
            <HistoryDaySection
              key={day.key}
              id={`${ids.title}-${day.key}`}
              label={day.label}
              entries={day.entries}
            />
          ))}
        </div>
      )}

      {history.isSuccess && entries.length === limit && (
        <Button
          className={styles.more}
          disabled={history.isFetching}
          onClick={() => setLimit((current) => current + PAGE)}
        >
          {HISTORY_COPY.showMore}
        </Button>
      )}
    </section>
  )
}

const HISTORY_VIEW_KEYS = { pending: 'pending', ready: 'ready' } as const

type HistoryPageViewProps = {
  [HISTORY_VIEW_KEYS.pending]: Parameters<typeof RouteState>[0]
  [HISTORY_VIEW_KEYS.ready]: HistoryViewProps
}

const HISTORY_VIEWS = {
  [HISTORY_VIEW_KEYS.pending]: RouteState,
  [HISTORY_VIEW_KEYS.ready]: HistoryView,
} as const satisfies ViewsOf<HistoryPageViewProps>

type HistoryPageViewOfProps = { library: RouteQuery<Library> }

/** Which view the page shows: its library on its way, missing or failing, or the history. */
const historyPageViewOf = ({ library }: HistoryPageViewOfProps): ViewOf<HistoryPageViewProps> => {
  if (library.state !== ROUTE_STATES.ready)
    return {
      key: HISTORY_VIEW_KEYS.pending,
      props: { state: library, noun: HISTORY_COPY.noun, shape: <HistorySkeleton /> },
    }
  return { key: HISTORY_VIEW_KEYS.ready, props: { library: library.data } }
}

/**
 * A library's history: what was watched by its own measure, or everything
 * that played, last played first and split into days. Which of the two is
 * in the URL, so coming back from the player lands on the same list.
 */
export const HistoryPage = () => {
  const libraryId = useRouteId()
  const library = routeState({ id: libraryId, query: useQuery(libraryQuery(libraryId)) })
  return (
    <KeyedView<HistoryPageViewProps> views={HISTORY_VIEWS} view={historyPageViewOf({ library })} />
  )
}
