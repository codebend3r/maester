import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { MatchCandidate, MediaItem } from '@raven/core'
import { type FormEvent, useEffect, useId, useRef, useState } from 'react'
import { Button } from '@/components/Button/Button'
import { api } from '@/lib/api'
import { queryKeys } from '@/lib/queryClient'
import styles from '@/components/FixMatchDialog/FixMatchDialog.module.scss'

/** What the dialog searches for: a movie now, a show once TV shows are matched. */
export type MatchType = 'movie'

const NOT_A: Record<MatchType, string> = { movie: 'Not a movie' }

const yearFrom = (text: string): number | null => {
  const year = Number.parseInt(text.trim(), 10)
  return Number.isInteger(year) && year > 1800 && year < 2200 ? year : null
}

const Candidate = ({
  candidate,
  disabled,
  onChoose,
}: {
  candidate: MatchCandidate
  disabled: boolean
  onChoose: () => void
}) => {
  const poster = api.candidatePosterUrl(candidate.poster)
  const name = candidate.year == null ? candidate.title : `${candidate.title} (${candidate.year})`
  return (
    <li className={styles.candidate}>
      <span className={styles.poster}>
        {poster ? (
          <img src={poster} alt="" loading="lazy" decoding="async" />
        ) : (
          <span aria-hidden="true">{candidate.title.slice(0, 1)}</span>
        )}
      </span>
      <span className={styles.details}>
        <span className={styles.name}>{candidate.title}</span>
        {candidate.year != null && <span className={styles.year}>{candidate.year}</span>}
        {candidate.overview != null && (
          <span className={styles.overview}>{candidate.overview}</span>
        )}
      </span>
      <Button
        className={styles.choose}
        disabled={disabled}
        onClick={onChoose}
        aria-label={`Choose ${name}`}
      >
        Choose
      </Button>
    </li>
  )
}

/**
 * Fix match: searches TMDB with the title and year the file's name gave, and
 * points the file at the result the viewer chooses, or at nothing. Whatever
 * is chosen is kept by folder, so renames and re-downloads keep it.
 */
export const FixMatchDialog = ({
  media,
  type,
  onClose,
  onMatched,
}: {
  media: MediaItem
  type: MatchType
  onClose: () => void
  onMatched?: (updated: MediaItem) => void
}) => {
  const dialog = useRef<HTMLDialogElement>(null)
  const ids = { title: useId(), query: useId(), year: useId(), results: useId() }
  const queryClient = useQueryClient()
  const [query, setQuery] = useState(media.title)
  const [year, setYear] = useState(media.year == null ? '' : String(media.year))
  const [asked, setAsked] = useState({ query: media.title.trim(), year: media.year })

  useEffect(() => {
    dialog.current?.showModal()
  }, [])

  const results = useQuery({
    queryKey: queryKeys.matchSearch({ type, query: asked.query, year: asked.year }),
    queryFn: () => api.searchMatches({ type, query: asked.query, year: asked.year }),
    enabled: asked.query !== '',
    staleTime: 5 * 60_000,
  })

  const choose = useMutation({
    mutationFn: (tmdbId: string | null) => api.setMatch({ mediaId: media.id, tmdbId }),
    onSuccess: async (updated) => {
      queryClient.setQueryData(queryKeys.mediaItem(updated.id), updated)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.libraries }),
        queryClient.invalidateQueries({ queryKey: queryKeys.items }),
        queryClient.invalidateQueries({ queryKey: queryKeys.favourites }),
      ])
      onMatched?.(updated)
      onClose()
    },
  })

  const search = (event: FormEvent) => {
    event.preventDefault()
    setAsked({ query: query.trim(), year: yearFrom(year) })
  }

  return (
    <dialog ref={dialog} className={styles.dialog} aria-labelledby={ids.title} onClose={onClose}>
      <div className={styles.body}>
        <header className={styles.header}>
          <h2 id={ids.title} className={styles.title}>
            Fix match
          </h2>
          <p className={styles.file}>{media.fileName}</p>
        </header>

        <search>
          <form className={styles.form} onSubmit={search}>
            <div className={styles.field}>
              <label htmlFor={ids.query}>Title</label>
              <input
                id={ids.query}
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                autoComplete="off"
              />
            </div>
            <div className={styles.field}>
              <label htmlFor={ids.year}>Year</label>
              <input
                id={ids.year}
                className={styles.yearInput}
                inputMode="numeric"
                value={year}
                onChange={(event) => setYear(event.target.value)}
                autoComplete="off"
              />
            </div>
            <Button type="submit" icon="search" className={styles.submit}>
              Search
            </Button>
          </form>
        </search>

        {(choose.isError || results.isError) && (
          <p role="alert" className={styles.error}>
            {(choose.error ?? results.error)?.message ?? 'Something went wrong.'}
          </p>
        )}

        <section
          aria-labelledby={ids.results}
          aria-busy={results.isFetching}
          className={styles.results}
        >
          <h3 id={ids.results} className="visually-hidden">
            Results
          </h3>
          {results.isSuccess && results.data.length === 0 && (
            <p className={styles.hint}>
              TMDB has nothing by that name. Try the original title, or no year.
            </p>
          )}
          {results.isFetching && !results.data && <p className={styles.hint}>Searching TMDB</p>}
          {!!results.data?.length && (
            <ul className={styles.list}>
              {results.data.map((candidate) => (
                <Candidate
                  key={candidate.tmdbId}
                  candidate={candidate}
                  disabled={choose.isPending}
                  onChoose={() => choose.mutate(candidate.tmdbId)}
                />
              ))}
            </ul>
          )}
        </section>

        <footer className={styles.actions}>
          <Button disabled={choose.isPending} onClick={() => choose.mutate(null)}>
            {NOT_A[type]}
          </Button>
          <Button onClick={onClose}>Cancel</Button>
        </footer>
      </div>
    </dialog>
  )
}
