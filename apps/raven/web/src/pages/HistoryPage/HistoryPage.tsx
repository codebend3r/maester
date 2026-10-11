import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ApiError, type HistoryEntry } from '@raven/core'
import { useId, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { Button, ButtonLink } from '@/components/Button/Button'
import { MediaTiles } from '@/components/MediaTiles/MediaTiles'
import { api } from '@/lib/api'
import { historyDays, historyNote } from '@/lib/history'
import { queryKeys } from '@/lib/queryClient'
import { NotFoundPage } from '@/pages/NotFoundPage/NotFoundPage'
import styles from '@/pages/HistoryPage/HistoryPage.module.scss'

/** How many entries a page of history adds. */
const PAGE = 100

type Show = 'watched' | 'all'

const SHOWS: ReadonlyArray<{ show: Show; label: string }> = [
  { show: 'watched', label: 'Watched' },
  { show: 'all', label: 'All played' },
]

/** One day's videos under its heading, each with how far it got and when. */
const HistoryDaySection = ({
  id,
  label,
  entries,
}: {
  id: string
  label: string
  entries: HistoryEntry[]
}) => {
  const notes = new Map(entries.map((entry) => [entry.media.id, historyNote(entry)]))
  return (
    <section className={styles.day} aria-labelledby={id}>
      <h2 id={id} className={styles.heading}>
        {label}
      </h2>
      <MediaTiles
        items={entries.map((entry) => entry.media)}
        note={(media) => notes.get(media.id) ?? null}
      />
    </section>
  )
}

/**
 * A library's history: what was watched by its own measure, or everything
 * that played, last played first and split into days. Which of the two is
 * in the URL, so coming back from the player lands on the same list.
 */
export const HistoryPage = () => {
  const params = useParams()
  const libraryId = Number(params.id)
  const ids = { title: useId() }
  const [searchParams, setSearchParams] = useSearchParams()
  const show: Show = searchParams.get('show') === 'all' ? 'all' : 'watched'
  const [limit, setLimit] = useState(PAGE)

  const library = useQuery({
    queryKey: queryKeys.library(libraryId),
    queryFn: () => api.getLibrary(libraryId),
    enabled: Number.isInteger(libraryId),
  })
  const history = useQuery({
    queryKey: queryKeys.history({ libraryId, show, limit }),
    queryFn: () => api.listHistory({ libraryId, limit, watchedOnly: show === 'watched' }),
    enabled: library.isSuccess,
    placeholderData: keepPreviousData,
  })

  const missing = library.error instanceof ApiError && library.error.status === 404
  if (!Number.isInteger(libraryId) || missing) return <NotFoundPage />
  if (library.isError) {
    return (
      <p className={styles.message} role="alert">
        {library.error.message}
      </p>
    )
  }
  if (!library.data) return <p className={styles.message}>Opening the history</p>

  const { name, settings } = library.data
  const entries = history.data ?? []

  return (
    <section className={styles.page} aria-labelledby={ids.title}>
      <ButtonLink to={`/libraries/${libraryId}`} icon="back" className={styles.back}>
        {name}
      </ButtonLink>

      <header className={styles.header}>
        <h1 id={ids.title} className={styles.title}>
          History
        </h1>
        <p className={styles.intro}>
          Videos played in {name}, last played first. One counts as watched once playback gets{' '}
          {settings.watchedPercent}% of the way through, which the library's settings can change.
        </p>
      </header>

      <fieldset className={styles.shows}>
        <legend className="visually-hidden">Show</legend>
        {SHOWS.map((option) => (
          <Button
            key={option.show}
            className={styles.show}
            aria-pressed={show === option.show}
            onClick={() => {
              setLimit(PAGE)
              setSearchParams(option.show === 'all' ? { show: 'all' } : {}, { replace: true })
            }}
          >
            {option.label}
          </Button>
        ))}
      </fieldset>

      {history.isError && (
        <p className={styles.message} role="alert">
          {history.error.message}
        </p>
      )}
      {history.isSuccess && entries.length === 0 && (
        <p className={styles.message}>
          {show === 'watched'
            ? `Nothing watched in ${name} yet.`
            : `Nothing played in ${name} yet.`}
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
          Show more
        </Button>
      )}
    </section>
  )
}
