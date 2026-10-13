import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { AiMatch, MatchCandidate, MatchItemType } from '@raven/core'
import { type FormEvent, useEffect, useId, useRef, useState } from 'react'
import { AiMatchNote } from '@/components/AiMatchNote/AiMatchNote'
import { Button } from '@/components/Button/Button'
import { api } from '@/lib/api'
import { afterMatch } from '@/lib/invalidate'
import { matchSearchQuery } from '@/lib/queries'
import styles from '@/components/FixMatchDialog/FixMatchDialog.module.scss'

const NOT_A: Record<MatchItemType, string> = { movie: 'Not a movie', show: 'Not a show' }

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
 * Fix match: searches TMDB with the title and year a name gave, and points
 * a file (or a whole show) at the result the viewer chooses, or at nothing.
 * `match` does the pointing; whatever is chosen is kept by folder, so
 * renames and re-downloads keep it.
 */
export const FixMatchDialog = <T,>({
  type,
  title,
  year,
  fileName,
  aiMatch = null,
  libraryId,
  match,
  allowNone = true,
  onClose,
  onMatched,
}: {
  /** What the dialog searches for: a movie, or a show. */
  type: MatchItemType
  /** What the search box starts with: the parsed title. */
  title: string
  year: number | null
  /** Named under the heading, so the viewer knows which file this is for. */
  fileName?: string
  /** Why the AI lookup matched what is being fixed, being sure; null or left out when it did not. */
  aiMatch?: AiMatch | null
  /** The library the file is in: the results its type prefers are listed first. */
  libraryId?: number
  /** Points the file or show at `tmdbId`, or at nothing for null. */
  match: (tmdbId: string | null) => Promise<T>
  /** Whether "Not a movie" (or show) is offered. */
  allowNone?: boolean
  onClose: () => void
  onMatched?: (result: T) => void
}) => {
  const dialog = useRef<HTMLDialogElement>(null)
  const ids = { title: useId(), query: useId(), year: useId(), results: useId() }
  const queryClient = useQueryClient()
  const [query, setQuery] = useState(title)
  const [yearText, setYearText] = useState(year == null ? '' : String(year))
  const [asked, setAsked] = useState({ query: title.trim(), year })

  useEffect(() => {
    dialog.current?.showModal()
  }, [])

  const results = useQuery(
    matchSearchQuery({ type, query: asked.query, year: asked.year, libraryId: libraryId ?? null }),
  )

  const choose = useMutation({
    mutationFn: match,
    onSuccess: async (result) => {
      await afterMatch(queryClient)
      onMatched?.(result)
      onClose()
    },
  })

  const search = (event: FormEvent) => {
    event.preventDefault()
    setAsked({ query: query.trim(), year: yearFrom(yearText) })
  }

  return (
    <dialog ref={dialog} className={styles.dialog} aria-labelledby={ids.title} onClose={onClose}>
      <div className={styles.body}>
        <header className={styles.header}>
          <h2 id={ids.title} className={styles.title}>
            Fix match
          </h2>
          {fileName && <p className={styles.file}>{fileName}</p>}
          {aiMatch && <AiMatchNote aiMatch={aiMatch} />}
        </header>

        <search>
          <form className={styles.form} onSubmit={search}>
            <div className={`${styles.field} ${styles.titleField}`}>
              <label htmlFor={ids.query}>Title</label>
              <input
                id={ids.query}
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                autoComplete="off"
              />
            </div>
            <div className={`${styles.field} ${styles.yearField}`}>
              <label htmlFor={ids.year}>Year</label>
              <input
                id={ids.year}
                className={styles.yearInput}
                inputMode="numeric"
                value={yearText}
                onChange={(event) => setYearText(event.target.value)}
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

        <footer className={allowNone ? styles.actions : styles.actionsEnd}>
          {allowNone && (
            <Button disabled={choose.isPending} onClick={() => choose.mutate(null)}>
              {NOT_A[type]}
            </Button>
          )}
          <Button onClick={onClose}>Cancel</Button>
        </footer>
      </div>
    </dialog>
  )
}
