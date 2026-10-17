import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  type AiMatch,
  type ConfidenceTier,
  confidenceTierOf,
  type MatchCandidate,
  type MatchItemType,
  type MatchSubject,
} from '@raven/core'
import { type FormEvent, useEffect, useId, useRef } from 'react'
import { AiMatchNote } from '@/components/AiMatchNote/AiMatchNote'
import { Button, Icon } from '@raven/ui'
import { SearchField } from '@/components/SearchField/SearchField'
import { api } from '@/lib/api'
import { afterMatch } from '@/lib/invalidate'
import { matchSearchQuery } from '@/lib/queries'
import { useSearch } from '@/lib/useSearch'
import styles from '@/components/FixMatchDialog/FixMatchDialog.module.scss'

const NOT_A: Record<MatchItemType, string> = { movie: 'Not a movie', show: 'Not a show' }

const yearFrom = (text: string): number | null => {
  const year = Number.parseInt(text.trim(), 10)
  return Number.isInteger(year) && year > 1800 && year < 2200 ? year : null
}

const TIER_WORDS: Record<ConfidenceTier, string> = {
  strong: 'Strong match',
  possible: 'Possible match',
  weak: 'Weak match',
}

const Candidate = ({
  candidate,
  isBest,
  disabled,
  onChoose,
}: {
  candidate: MatchCandidate
  /** The first result, when it is Strong: named the best match. */
  isBest: boolean
  disabled: boolean
  onChoose: () => void
}) => {
  const tierId = useId()
  const poster = api.candidatePosterUrl(candidate.poster)
  const name = candidate.year == null ? candidate.title : `${candidate.title} (${candidate.year})`
  const tier = confidenceTierOf(candidate.confidence)
  return (
    <li className={isBest ? `${styles.candidate} ${styles.best}` : styles.candidate}>
      <span className={styles.poster}>
        {poster ? (
          <img src={poster} alt="" loading="lazy" decoding="async" />
        ) : (
          <span className={styles.initial} aria-hidden="true">
            {candidate.title.slice(0, 1)}
          </span>
        )}
        <span className={`${styles.stamp} ${styles[tier]}`} aria-hidden="true">
          {tier === 'strong' && <Icon name="check" size={12} />}
          {candidate.confidence}
        </span>
      </span>
      <span className={styles.details}>
        <span className={styles.name}>{candidate.title}</span>
        {candidate.year != null && <span className={styles.year}>{candidate.year}</span>}
        <span id={tierId} className={`${styles.tier} ${styles[tier]}`}>
          {isBest && <Icon name="check" size={14} />}
          <span>{isBest ? 'Best match' : TIER_WORDS[tier]}</span>
          <span className="visually-hidden">, confidence {candidate.confidence} out of 100</span>
        </span>
        {candidate.overview != null && (
          <span className={styles.overview}>{candidate.overview}</span>
        )}
      </span>
      <Button
        className={styles.choose}
        disabled={disabled}
        onClick={onChoose}
        aria-label={`Choose ${name}`}
        aria-describedby={tierId}
      >
        Choose
      </Button>
    </li>
  )
}

/**
 * Fix match: searches TMDB with the title and year a name gave, and again
 * as the viewer edits them, scored against what the subject has on disk
 * and listed best first, and points a
 * file (or a whole show) at the result the viewer chooses, or at nothing.
 * `match` does the pointing; whatever is chosen is kept by folder, so
 * renames and re-downloads keep it. Not a movie and Cancel sit in a footer
 * that stays in view as the results scroll.
 */
export const FixMatchDialog = <T,>({
  type,
  title,
  year,
  fileName,
  aiMatch = null,
  libraryId,
  subject,
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
  /** The file (and its show folder) or the show being fixed: the results are scored against what it has on disk. */
  subject: MatchSubject
  /** Points the file or show at `tmdbId`, or at nothing for null. */
  match: (tmdbId: string | null) => Promise<T>
  /** Whether "Not a movie" (or show) is offered. */
  allowNone?: boolean
  onClose: () => void
  onMatched?: (result: T) => void
}) => {
  const dialog = useRef<HTMLDialogElement>(null)
  const ids = { title: useId(), note: useId(), query: useId(), year: useId(), results: useId() }
  const queryClient = useQueryClient()
  // The year is half the search, so it settles as the title does.
  const typed = {
    title: useSearch({ initial: title }),
    year: useSearch({ initial: year == null ? '' : String(year) }),
  }
  const asked = { query: typed.title.query, year: yearFrom(typed.year.query) }

  useEffect(() => {
    dialog.current?.showModal()
  }, [])

  const results = useQuery(
    matchSearchQuery({
      type,
      query: asked.query,
      year: asked.year,
      libraryId: libraryId ?? null,
      subject,
    }),
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
    typed.title.searchNow()
    typed.year.searchNow()
  }

  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-labelledby={ids.title}
      aria-describedby={aiMatch ? ids.note : undefined}
      onClose={onClose}
    >
      <div className={styles.body}>
        <header className={styles.header}>
          <h2 id={ids.title} className={styles.title}>
            Fix match
          </h2>
          {fileName && <p className={styles.file}>{fileName}</p>}
          {aiMatch && <AiMatchNote aiMatch={aiMatch} id={ids.note} />}
        </header>

        <search>
          <form className={styles.form} onSubmit={search}>
            <div className={`${styles.field} ${styles.titleField}`}>
              <label htmlFor={ids.query}>Title</label>
              <SearchField id={ids.query} search={typed.title} autoComplete="off" />
            </div>
            <div className={`${styles.field} ${styles.yearField}`}>
              <label htmlFor={ids.year}>Year</label>
              <input
                id={ids.year}
                inputMode="numeric"
                value={typed.year.text}
                onChange={(event) => typed.year.setText(event.target.value)}
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
            <Icon name="alert" size={16} />
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
              {results.data.map((candidate, index) => (
                <Candidate
                  key={candidate.tmdbId}
                  candidate={candidate}
                  isBest={index === 0 && confidenceTierOf(candidate.confidence) === 'strong'}
                  disabled={choose.isPending}
                  onChoose={() => choose.mutate(candidate.tmdbId)}
                />
              ))}
            </ul>
          )}
        </section>
      </div>

      <footer className={styles.actions}>
        {allowNone && (
          <Button
            className={styles.none}
            disabled={choose.isPending}
            onClick={() => choose.mutate(null)}
          >
            {NOT_A[type]}
          </Button>
        )}
        <Button className={styles.cancel} onClick={onClose}>
          Cancel
        </Button>
      </footer>
    </dialog>
  )
}
